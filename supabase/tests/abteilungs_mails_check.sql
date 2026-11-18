-- Assertions for migration abteilungs_mails. Run only inside a transaction that is rolled back (after the migration body).
do $$
declare v_admin uuid := gen_random_uuid(); v_pl uuid := gen_random_uuid(); v_prot uuid := gen_random_uuid(); ok boolean; n int; r jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values (v_admin, 'ZZ AM Admin', 'Admin', true), (v_pl, 'ZZ AM PL', 'PL', true);
  insert into public.protocols (id, date, action) values (v_prot, '2099-01-05', 'Aufbau');

  -- Defaults are there
  if (select value from public.app_settings where key = 'department_mail_test_mode') <> 'true'::jsonb then raise exception 'test mode default missing'; end if;
  if (select value ->> 'mobiliar' from public.app_settings where key = 'department_routes') <> 'lager' then raise exception 'routes default missing'; end if;

  -- service_role writes the log, the unique key stops a second identical mail
  set local role service_role;
  insert into public.department_mail_log (protocol_id, department, items, items_hash) values (v_prot, 'stoffe', '["a"]', 'h1');
  ok := false; begin insert into public.department_mail_log (protocol_id, department, items, items_hash) values (v_prot, 'stoffe', '["a"]', 'h1');
  exception when unique_violation then ok := true; end;
  if not ok then raise exception 'duplicate log row allowed'; end if;
  ok := false; begin insert into public.department_mail_log (protocol_id, department, items_hash) values (v_prot, 'fremd', 'h2');
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'unknown department allowed'; end if;
  reset role;

  -- PL sees nothing and can't write; Admin reads
  perform set_config('request.jwt.claims', json_build_object('sub', v_pl, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.department_mail_log where protocol_id = v_prot;
  if n <> 0 then raise exception 'PL sees log'; end if;
  ok := false; begin insert into public.department_mail_log (protocol_id, department, items_hash) values (v_prot, 'lager', 'h3');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'PL could write log'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.department_mail_log where protocol_id = v_prot;
  if n <> 1 then raise exception 'Admin sees % log rows', n; end if;
  reset role;

  -- apply_app_settings takes the new keys and rejects bad routes
  r := public.apply_app_settings('{"department_mail_test_mode": false, "department_routes": {"tischlerei": "lager", "mobiliar": ""}}'::jsonb, v_admin);
  if r -> 'department_mail_test_mode' <> 'false'::jsonb or r -> 'department_routes' ->> 'tischlerei' <> 'lager' then raise exception 'settings not applied: %', r; end if;
  ok := false; begin perform public.apply_app_settings('{"department_routes": {"mobiliar": "x@evil.test"}}'::jsonb, v_admin);
  exception when others then ok := sqlerrm like 'invalid_setting%'; end;
  if not ok then raise exception 'foreign address accepted as route'; end if;
  ok := false; begin perform public.apply_app_settings('{"department_routes": {"kueche": "lager"}}'::jsonb, v_admin);
  exception when others then ok := sqlerrm like 'invalid_setting%'; end;
  if not ok then raise exception 'unknown area accepted'; end if;
  ok := false; begin perform public.apply_app_settings('{"department_mail_enabled": "ja"}'::jsonb, v_admin);
  exception when others then ok := sqlerrm like 'invalid_setting%'; end;
  if not ok then raise exception 'non-boolean switch accepted'; end if;
  -- old keys still work
  perform public.apply_app_settings('{"availability_for_all": false, "billing_cutoff": 20}'::jsonb, v_admin);

  -- anon gets nothing
  set local role anon;
  ok := false; begin perform 1 from public.department_mail_log; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'anon can read log'; end if;
  reset role;
  raise notice 'abteilungs_mails_check: ok';
end $$;
