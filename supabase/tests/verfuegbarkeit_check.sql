-- Assertions for migration verfuegbarkeit. Run only inside a transaction that is rolled back (after the migration body);
-- raises on the first failed check. Temporary users 'ZZ AV …' disappear with the rollback.
do $$
declare
  v_ma uuid := gen_random_uuid();   -- unlocked MA
  v_ma2 uuid := gen_random_uuid();  -- MA without the flag
  v_gast uuid := gen_random_uuid();
  v_view uuid := gen_random_uuid(); -- PL with plan_interest_viewer
  n int; ok boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active, availability_enabled, plan_interest_viewer) values
    (v_ma, 'ZZ AV MA', 'MA', true, true, false), (v_ma2, 'ZZ AV MA2', 'MA', true, false, false),
    (v_gast, 'ZZ AV Gast', 'Gast', true, true, false), (v_view, 'ZZ AV Viewer', 'PL', true, false, true);
  insert into public.availability (user_id, day, level) values (v_ma2, current_date + 3, 'nein');

  -- ── MA ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.availability (user_id, day, level) values (v_ma, current_date, 'notfall');
  update public.availability set level = 'nein' where user_id = v_ma and day = current_date;
  ok := false; begin insert into public.availability values (v_ma2, current_date + 1, 'nein');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA wrote a row of someone else'; end if;
  ok := false; begin insert into public.availability values (v_ma, current_date - 1, 'nein');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA wrote a past day'; end if;
  ok := false; begin insert into public.availability values (v_ma, current_date + 1, 'vielleicht');
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'unknown level accepted'; end if;
  select count(*) into n from public.availability where user_id <> v_ma;
  if n <> 0 then raise exception 'MA reads other rows: %', n; end if;
  select count(*) into n from public.availability_people();
  if n <> 0 then raise exception 'MA gets the people list: %', n; end if;
  delete from public.availability where user_id = v_ma2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'MA deleted a row of someone else'; end if;
  reset role;

  -- ── Gast ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_gast, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin insert into public.availability values (v_gast, current_date + 1, 'nein');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'Gast wrote a row'; end if;
  reset role;

  -- ── Viewer ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.availability where user_id in (v_ma, v_ma2);
  if n <> 2 then raise exception 'viewer sees % rows, expected 2', n; end if;
  select count(*) into n from public.availability_people() p where p.id in (v_ma, v_ma2, v_gast, v_view);
  if n <> 1 then raise exception 'people list (flag only): %, expected 1', n; end if;
  reset role;
  update public.app_settings set value = 'true'::jsonb where key = 'availability_for_all';
  set local role authenticated;
  select count(*) into n from public.availability_people() p where p.id in (v_ma, v_ma2, v_gast, v_view);
  if n <> 3 then raise exception 'people list (for all): %, expected 3 (no Gast)', n; end if;
  reset role;

  -- ── settings whitelist ──
  perform public.apply_app_settings('{"availability_for_all": false}'::jsonb, null);
  ok := false; begin perform public.apply_app_settings('{"availability_for_all": "x"}'::jsonb, null);
  exception when raise_exception then ok := true; end;
  if not ok then raise exception 'non-boolean availability_for_all accepted'; end if;

  raise notice 'verfuegbarkeit_check: all checks passed';
end $$;
