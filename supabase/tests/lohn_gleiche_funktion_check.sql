-- Assertions for migration lohn_gleiche_funktion. Run only inside a transaction that is rolled back (after the migration body).
do $$
declare v_admin uuid := gen_random_uuid(); v_ma uuid := gen_random_uuid(); v_old uuid := gen_random_uuid(); r record;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active, employment_type, role_rates) values
    (v_admin, 'ZZ LF Admin', 'Admin', true, 'Fest', '[]'),
    (v_ma, 'ZZ LF Max Muster', 'AL', true, 'Midijob', '[{"role": "MA Midijob", "rate_conni": 17}, {"role": "AL Midijob", "rate_conni": 20}]'),
    (v_old, 'ZZ LF Lena Beispiel', 'MA', true, 'Minijob', '[{"role": "MA frei", "rate_conni": 16}]');
  insert into public.app_user_private (user_id, hourly_rate_conni, income_limit) values (v_ma, null, 1000);
  insert into public.shifts (user_id, position_role, start_time, end_time, pause_mins, status, shift_date) values
    (v_ma, 'MA Midijob', '08:00', '14:00', 0, 'offen', current_date),
    (v_ma, 'AL Midijob', '08:00', '14:00', 0, 'offen', current_date),
    (v_ma, 'Fahrer Midijob', '08:00', '14:00', 0, 'offen', current_date), -- no rate: counts 0 €
    (v_ma, 'MA Minijob', '08:00', '14:00', 0, 'offen', current_date - 1), -- older type: still the MA rate 17 €
    (v_old, 'MA Minijob', '08:00', '14:00', 0, 'offen', current_date);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- 6 × 17 + 6 × 20 + 6 × 17 = 324 € of 1000 € → 32 %
  select * into r from public.income_shares(array[v_ma, v_old], current_date - 3, current_date + 3, current_date - 60, 1) where user_id = v_ma;
  if r.pct <> 32 or r.hours <> 24.0 or not r.has_rate then raise exception 'per-function pay wrong: %', row_to_json(r); end if;
  -- old entry "MA frei" applies to MA Minijob: 6 × 16 = 96 € of 603 € → 16 %
  select * into r from public.income_shares(array[v_old], current_date - 3, current_date + 3, current_date - 60, 1);
  if r.pct <> round(96 / (select (value #>> '{}')::numeric from public.app_settings where key = 'income_limit_minijob') * 100)::int then
    raise exception 'legacy entry wrong: %', row_to_json(r); end if;
  reset role;
  raise notice 'lohn_gleiche_funktion_check: ok';
end $$;
