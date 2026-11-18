-- Assertions for migration mitarbeiter_pflegen. Run only inside a transaction that is rolled back (after the migration body).
do $$
declare
  v_admin uuid := gen_random_uuid(); v_ma uuid := gen_random_uuid(); v_ma2 uuid := gen_random_uuid(); v_bh uuid := gen_random_uuid();
  v_s1 uuid; v_s2 uuid; v_z uuid; n int; ok boolean; r record; s jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active, employment_type) values
    (v_admin, 'ZZ MP Admin', 'Admin', true, 'Fest'), (v_ma, 'ZZ MP Max Muster', 'MA', true, 'Minijob'),
    (v_ma2, 'ZZ MP Lena Beispiel', 'MA', true, 'Midijob'), (v_bh, 'ZZ MP BH', 'Buchhaltung', true, 'Fest');
  insert into public.app_user_private (user_id, hourly_rate_conni) values (v_ma, 15), (v_ma2, 20);
  insert into public.shifts (id, temp_worker_name, position_role, start_time, end_time, pause_mins, status, shift_date)
    values (gen_random_uuid(), ' ZZ Maxx ', 'MA Minijob', '08:00', '16:00', 0, 'offen', current_date) returning id into v_s1;
  insert into public.shifts (id, temp_worker_name, position_role, start_time, end_time, status, shift_date)
    values (gen_random_uuid(), 'zz maxx', 'Zenjob', '08:00', '12:00', 'offen', current_date) returning id into v_z;

  -- Settings: new keys validated
  s := public.apply_app_settings('{"income_limit_minijob": 556, "inactive_months": 2}'::jsonb, v_admin);
  if (s ->> 'income_limit_minijob')::numeric <> 556 then raise exception 'limit not saved'; end if;
  ok := false; begin perform public.apply_app_settings('{"inactive_months": 0}'::jsonb, v_admin); exception when others then ok := true; end;
  if not ok then raise exception 'inactive_months 0 accepted'; end if;
  ok := false; begin perform public.apply_app_settings('{"income_limit_midijob": "x"}'::jsonb, v_admin); exception when others then ok := true; end;
  if not ok then raise exception 'string limit accepted'; end if;

  -- MA: no assign, no minors, no aliases
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.assign_worker_name('zz maxx', v_ma); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA could assign'; end if;
  ok := false; begin insert into public.staff_minors (user_id) values (v_ma); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA could set the tick'; end if;
  select count(*) into n from public.worker_name_aliases; if n <> 0 then raise exception 'MA reads aliases'; end if;
  if public.i_am_minor() then raise exception 'MA minor without tick'; end if;
  select count(*) into n from public.income_shares(array[v_ma], current_date - 30, current_date, current_date - 60, 1);
  if n <> 0 then raise exception 'MA sees income shares'; end if;
  -- own photo on, consent kept
  perform public.set_my_photo(true);
  reset role;
  select count(*) into n from public.app_users where id = v_ma and photo_path = v_ma::text || '.jpg' and photo_consent_at is not null;
  if n <> 1 then raise exception 'photo not set'; end if;

  -- Admin: assign, minor tick, shares
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.assign_worker_name('ZZ MAXX', v_ma);
  if n <> 1 then raise exception 'assign changed % shifts, expected 1 (Zenjob stays)', n; end if;
  select count(*) into n from public.shifts where id = v_z and user_id is null; if n <> 1 then raise exception 'Zenjob assigned'; end if;
  select count(*) into n from public.shifts where id = v_s1 and user_id = v_ma and temp_worker_name = ' ZZ Maxx '; if n <> 1 then raise exception 'free text lost'; end if;
  select count(*) into n from public.worker_name_aliases where alias = 'zz maxx' and user_id = v_ma; if n <> 1 then raise exception 'alias missing'; end if;
  insert into public.staff_minors (user_id) values (v_ma2);
  select count(*) into n from public.minors_among(array[v_ma, v_ma2]); if n <> 1 then raise exception 'minors_among %', n; end if;
  -- 8 h × 15 € = 120 € of 556 € → 22 %
  select * into r from public.income_shares(array[v_ma, v_ma2], current_date - 5, current_date + 5, current_date - 60, 1) where user_id = v_ma;
  if r.pct <> 22 or r.hours <> 8.0 or not r.has_limit or not r.has_rate then raise exception 'share wrong: %', row_to_json(r); end if;
  n := public.unassign_worker_name('zz maxx', v_ma);
  if n <> 1 then raise exception 'unassign %', n; end if;
  select count(*) into n from public.worker_name_aliases; if n <> 0 then raise exception 'alias kept after undo'; end if;
  perform public.clear_photo(v_ma);
  reset role;

  -- Buchhaltung reads the tick, PL does not
  perform set_config('request.jwt.claims', json_build_object('sub', v_bh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.staff_minors where user_id = v_ma2; if n <> 1 then raise exception 'BH cannot read the tick'; end if;
  reset role;
  update public.app_users set role = 'PL' where id = v_bh;
  set local role authenticated;
  select count(*) into n from public.staff_minors; if n <> 0 then raise exception 'PL reads the tick'; end if;
  reset role;

  -- The person with the tick knows it
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.i_am_minor() then raise exception 'i_am_minor false'; end if;
  reset role;
  raise notice 'mitarbeiter_pflegen_check: ok';
end $$;
