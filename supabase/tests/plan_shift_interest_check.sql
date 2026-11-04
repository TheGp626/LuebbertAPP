-- Assertions for migration plan_shift_interest. Run only inside a transaction that is rolled back.
do $$
declare
  v_ma uuid := gen_random_uuid();
  v_ma2 uuid := gen_random_uuid();
  v_pl uuid := gen_random_uuid();
  v_gast uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_week uuid := gen_random_uuid();
  n integer;
  ok boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values
    (v_ma, 'ZZ PSI MA', 'MA', true), (v_ma2, 'ZZ PSI MA2', 'MA', true),
    (v_pl, 'ZZ PSI PL', 'PL', true), (v_gast, 'ZZ PSI Gast', 'Gast', true);
  insert into public.app_users (id, full_name, role, is_active, plan_interest_viewer) values (v_viewer, 'ZZ PSI Viewer', 'AL', true, true);
  insert into public.plan_weeks (id, year, kw, week_start, week_end) values (v_week, 1999, 1, '1999-01-04', '1999-01-10');
  insert into public.plan_shift_interest (week_id, shift_key, user_id) values (v_week, 'k1', v_ma2);

  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.plan_shift_interest (week_id, shift_key, user_id) values (v_week, 'k1', v_ma);
  ok := false;
  begin insert into public.plan_shift_interest (week_id, shift_key, user_id) values (v_week, 'k2', v_ma2);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: MA inserted for another user'; end if;
  select count(*) into n from public.plan_shift_interest where week_id = v_week;
  if n <> 1 then raise exception 'check failed: MA sees % rows, expected 1', n; end if;
  delete from public.plan_shift_interest where user_id = v_ma2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'check failed: MA deleted another user''s row'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_gast, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin insert into public.plan_shift_interest (week_id, shift_key, user_id) values (v_week, 'k3', v_gast);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: Gast inserted'; end if;
  reset role;

  -- AL with the viewer flag sees everyone's interest but cannot delete it
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.plan_shift_interest where week_id = v_week;
  if n <> 2 then raise exception 'check failed: flagged AL sees % rows, expected 2', n; end if;
  delete from public.plan_shift_interest where week_id = v_week;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'check failed: flagged AL deleted % rows', n; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_pl, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.plan_shift_interest where week_id = v_week;
  if n <> 2 then raise exception 'check failed: PL sees % rows, expected 2', n; end if;
  delete from public.plan_shift_interest where week_id = v_week;
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'check failed: PL deleted % rows, expected 2', n; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;
select 'all plan_shift_interest checks passed' as result;
