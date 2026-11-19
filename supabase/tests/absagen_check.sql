-- Assertions for migration absagen. Run only inside a transaction that is rolled back (after the migration body).
do $$
declare
  v_ma uuid := gen_random_uuid(); v_ma2 uuid := gen_random_uuid(); v_pl uuid := gen_random_uuid(); v_gast uuid := gen_random_uuid();
  v_week uuid; v_shift uuid; v_old uuid; n int; ok boolean;
  today date := (now() at time zone 'Europe/Berlin')::date;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values
    (v_ma, 'ZZ AB MA', 'MA', true), (v_ma2, 'ZZ AB MA2', 'MA', true), (v_pl, 'ZZ AB PL', 'PL', true), (v_gast, 'ZZ AB Gast', 'Gast', true);
  insert into public.plan_weeks (year, kw, week_start, week_end) values (2099, 2, '2099-01-05', '2099-01-11') returning id into v_week;
  insert into public.plan_shifts (week_id, date, key) values (v_week, today + 1, 'zz|ab') returning id into v_shift;
  insert into public.plan_shifts (week_id, date, key) values (v_week, today - 1, 'zz|alt') returning id into v_old;
  insert into public.plan_assignments (shift_id, name, user_id) values (v_shift, 'ZZ', v_ma), (v_old, 'ZZ', v_ma), (v_shift, 'ZZ2', v_gast);

  -- MA on the shift
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.plan_cancellations (week_id, shift_key, user_id) values (v_week, 'zz|ab', v_ma);
  ok := false; begin insert into public.plan_cancellations (week_id, shift_key, user_id) values (v_week, 'zz|alt', v_ma);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA cancelled a past shift'; end if;
  ok := false; begin insert into public.plan_cancellations (week_id, shift_key, user_id, status) values (v_week, 'zz|ab', v_ma2, 'offen');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA cancelled for someone else'; end if;
  update public.plan_cancellations set status = 'erledigt' where week_id = v_week;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'MA handled their own Absage'; end if;
  reset role;

  -- MA2 is not on the shift: may not cancel it, sees nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin insert into public.plan_cancellations (week_id, shift_key, user_id) values (v_week, 'zz|ab', v_ma2);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA2 cancelled a shift they are not on'; end if;
  select count(*) into n from public.plan_cancellations where week_id = v_week;
  if n <> 0 then raise exception 'MA2 sees % Absagen', n; end if;
  reset role;

  -- Gast is on the shift but may never cancel
  perform set_config('request.jwt.claims', json_build_object('sub', v_gast, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin insert into public.plan_cancellations (week_id, shift_key, user_id) values (v_week, 'zz|ab', v_gast);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'Gast cancelled'; end if;
  reset role;

  -- PL handles it; the server stamps who and when
  perform set_config('request.jwt.claims', json_build_object('sub', v_pl, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.plan_cancellations where week_id = v_week;
  if n <> 1 then raise exception 'PL sees % Absagen', n; end if;
  update public.plan_cancellations set status = 'erledigt', replacement_user_id = v_ma2 where week_id = v_week;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'PL could not handle the Absage'; end if;
  reset role;
  select count(*) into n from public.plan_cancellations where week_id = v_week and decided_by = v_pl and decided_at is not null;
  if n <> 1 then raise exception 'decided_by/decided_at not stamped'; end if;

  -- MA can no longer withdraw a handled one
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.plan_cancellations where week_id = v_week;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'MA withdrew a handled Absage'; end if;
  reset role;

  delete from public.plan_weeks where id = v_week;
  select count(*) into n from public.plan_cancellations where week_id = v_week;
  if n <> 0 then raise exception 'Absagen survived their week'; end if;
  raise notice 'absagen_check: ok';
end $$;
