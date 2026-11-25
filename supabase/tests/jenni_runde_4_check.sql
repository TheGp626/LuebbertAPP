-- Assertions for migration jenni_runde_4. Run only inside a transaction that is rolled back (after the migration body).
do $$
declare v_admin uuid := gen_random_uuid(); v_pl uuid := gen_random_uuid(); v_prot uuid := gen_random_uuid(); ok boolean; r jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values (v_admin, 'ZZ J4 Admin', 'Admin', true), (v_pl, 'ZZ J4 PL', 'PL', true);
  insert into public.protocols (id, date, action) values (v_prot, '2099-01-05', 'Aufbau');

  -- 1. night rate optional, validated
  r := public.apply_app_settings('{"vehicle_rates": {"Solo": {"wk": 70, "sa": 70, "so": 70, "na": 95}, "PKW": {"wk": 20, "sa": 20, "so": 20}}}'::jsonb, v_admin);
  if r -> 'vehicle_rates' -> 'Solo' ->> 'na' <> '95' then raise exception 'night rate not stored: %', r; end if;
  ok := false; begin perform public.apply_app_settings('{"vehicle_rates": {"Solo": {"wk": 70, "sa": 70, "so": 70, "na": -1}}}'::jsonb, v_admin);
  exception when others then ok := sqlerrm like 'invalid_setting%'; end;
  if not ok then raise exception 'negative night rate accepted'; end if;
  ok := false; begin perform public.apply_app_settings('{"vehicle_rates": {"Solo": {"wk": 70, "sa": 70, "so": 70, "xx": 1}}}'::jsonb, v_admin);
  exception when others then ok := sqlerrm like 'invalid_setting%'; end;
  if not ok then raise exception 'unknown rate key accepted'; end if;
  insert into public.protocol_transports (protocol_id, vehicle_type, night) values (v_prot, 'Solo', true);

  -- 2. an edit by a person is marked, one without auth.uid() keeps the old mark
  perform set_config('request.jwt.claims', json_build_object('sub', v_pl, 'role', 'authenticated')::text, true);
  update public.protocols set notes_feedback = 'ok' where id = v_prot;
  if (select edited_by from public.protocols where id = v_prot) is distinct from v_pl then raise exception 'edit not marked'; end if;
  perform set_config('request.jwt.claims', '', true);
  update public.protocols set mailed_at = now() where id = v_prot;
  if (select edited_by from public.protocols where id = v_prot) is distinct from v_pl then raise exception 'service update overwrote the mark'; end if;

  -- 3. photos: at most 8
  update public.protocols set photos = '["2099-01/a.jpg"]'::jsonb where id = v_prot;
  ok := false; begin update public.protocols set photos = '[1,2,3,4,5,6,7,8,9]'::jsonb where id = v_prot;
  exception when check_violation then ok := true; end;
  if not ok then raise exception '9 photos accepted'; end if;
  if not exists (select 1 from storage.buckets where id = 'protocol-photos' and public = false) then raise exception 'bucket missing or public'; end if;

  -- 4. ask_log: once per person and shift; nobody but service_role
  insert into public.ask_log (asked_by, user_id, ref) values (v_admin, v_pl, 'shift:x|y');
  ok := false; begin insert into public.ask_log (asked_by, user_id, ref) values (v_admin, v_pl, 'shift:x|y');
  exception when unique_violation then ok := true; end;
  if not ok then raise exception 'second ask allowed'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform 1 from public.ask_log; exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'authenticated can read ask_log'; end if;
  raise notice 'jenni_runde_4_check: ok';
end $$;
