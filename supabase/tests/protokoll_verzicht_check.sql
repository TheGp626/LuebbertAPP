-- Assertions for migration protokoll_verzicht. Run only inside a transaction that is rolled back (after the migration body).
do $$
declare v_ma uuid := gen_random_uuid(); v_al uuid := gen_random_uuid(); v_al2 uuid := gen_random_uuid(); v_pl uuid := gen_random_uuid();
  v_gast uuid := gen_random_uuid(); ok boolean; n int;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values
    (v_ma, 'ZZ PV MA', 'MA', true), (v_al, 'ZZ PV AL', 'AL', true), (v_al2, 'ZZ PV AL2', 'AL', true), (v_pl, 'ZZ PV PL', 'PL', true), (v_gast, 'ZZ PV Gast', 'Gast', true);

  -- AL marks one; created_by defaults to the caller
  perform set_config('request.jwt.claims', json_build_object('sub', v_al, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.protocol_waivers (date, event_key, event_label, shift_keys) values ('2099-01-05', 'zz gala', 'ZZ Gala', array['k1', 'k2']);
  ok := false; begin insert into public.protocol_waivers (date, event_key, created_by) values ('2099-01-06', 'zz fremd', v_al2);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'AL marked in someone else''s name'; end if;
  reset role;
  if not exists (select 1 from public.protocol_waivers where event_key = 'zz gala' and created_by = v_al) then raise exception 'created_by not set'; end if;

  -- MA sees it but may not mark or undo
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.protocol_waivers where event_key like 'zz %';
  if n <> 1 then raise exception 'MA sees % marks', n; end if;
  ok := false; begin insert into public.protocol_waivers (date, event_key) values ('2099-01-07', 'zz ma');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA could mark'; end if;
  delete from public.protocol_waivers where event_key = 'zz gala'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'MA could undo'; end if;
  reset role;

  -- Gast sees nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_gast, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.protocol_waivers where event_key like 'zz %';
  if n <> 0 then raise exception 'Gast sees % marks', n; end if;
  reset role;

  -- Another AL can't undo it, the PL can
  perform set_config('request.jwt.claims', json_build_object('sub', v_al2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.protocol_waivers where event_key = 'zz gala'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'other AL could undo'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pl, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.protocol_waivers where event_key = 'zz gala'; get diagnostics n = row_count;
  if n <> 1 then raise exception 'PL could not undo'; end if;
  reset role;

  -- anon gets nothing at all
  set local role anon;
  ok := false; begin perform 1 from public.protocol_waivers; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'anon can read'; end if;
  reset role;
  raise notice 'protokoll_verzicht_check: ok';
end $$;
