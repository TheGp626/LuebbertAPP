-- Assertions for migration abteilungs_adressen. Run only inside a transaction that is rolled back (after the migration body).
do $$
declare v_admin uuid := gen_random_uuid(); v_prot uuid := gen_random_uuid(); ok boolean; r jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values (v_admin, 'ZZ AA Admin', 'Admin', true);
  insert into public.protocols (id, date, action) values (v_prot, '2099-01-05', 'Aufbau');

  if (select value ->> 'lager' from public.app_settings where key = 'department_emails') <> 'lager@peterluebbert.de' then raise exception 'emails default missing'; end if;

  -- new departments in the log and in the routes
  set local role service_role;
  insert into public.department_mail_log (protocol_id, department, items_hash) values (v_prot, 'tischlerei', 'h1');
  reset role;
  r := public.apply_app_settings('{"department_routes": {"logistik": "logistik", "tischlerei": "tischlerei"}, "department_emails": {"logistik": "d.test@peterluebbert.de", "tischlerei": "", "lager": "Lager@PeterLuebbert.de"}}'::jsonb, v_admin);
  if r -> 'department_emails' ->> 'logistik' <> 'd.test@peterluebbert.de' or r -> 'department_routes' ->> 'tischlerei' <> 'tischlerei' then raise exception 'settings not applied: %', r; end if;

  -- only company addresses, only known departments
  ok := false; begin perform public.apply_app_settings('{"department_emails": {"lager": "x@evil.test"}}'::jsonb, v_admin);
  exception when others then ok := sqlerrm like 'invalid_setting%'; end;
  if not ok then raise exception 'foreign address accepted'; end if;
  ok := false; begin perform public.apply_app_settings('{"department_emails": {"lager": "a@peterluebbert.de.evil.test"}}'::jsonb, v_admin);
  exception when others then ok := sqlerrm like 'invalid_setting%'; end;
  if not ok then raise exception 'look-alike domain accepted'; end if;
  ok := false; begin perform public.apply_app_settings('{"department_emails": {"kueche": "k@peterluebbert.de"}}'::jsonb, v_admin);
  exception when others then ok := sqlerrm like 'invalid_setting%'; end;
  if not ok then raise exception 'unknown department accepted'; end if;
  ok := false; begin perform public.apply_app_settings('{"department_emails": {"lager": 5}}'::jsonb, v_admin);
  exception when others then ok := sqlerrm like 'invalid_setting%'; end;
  if not ok then raise exception 'non-string address accepted'; end if;
  raise notice 'abteilungs_adressen_check: ok';
end $$;
