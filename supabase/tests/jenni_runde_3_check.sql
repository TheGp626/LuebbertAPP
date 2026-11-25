-- Assertions for migration jenni_runde_3. Run only inside a transaction that is rolled back (after the migration body).
do $$
declare v_ma uuid := gen_random_uuid(); ok boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values (v_ma, 'ZZ J3 MA', 'MA', true);

  -- the person writes a Meldung with a limit; too long is refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.order_applications (job_no, phase, user_id, vorbehalt) values ('99-0001.01', 'setup', v_ma, 'nur bis 16:00 Uhr');
  ok := false; begin insert into public.order_applications (job_no, phase, user_id, vorbehalt) values ('99-0001.01', 'teardown', v_ma, repeat('x', 41));
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'overlong vorbehalt accepted'; end if;
  reset role;
  if (select vorbehalt from public.order_applications where job_no = '99-0001.01' and user_id = v_ma) <> 'nur bis 16:00 Uhr' then raise exception 'vorbehalt not stored'; end if;

  -- hours check log
  insert into public.plan_reminder_log (al_id, date, day, kind) values (v_ma, '2099-01-18', '2099-01-18', 'hours_check');
  ok := false; begin insert into public.plan_reminder_log (al_id, date, day, kind) values (v_ma, '2099-01-18', '2099-01-18', 'quatsch');
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'unknown kind accepted'; end if;
  raise notice 'jenni_runde_3_check: ok';
end $$;
