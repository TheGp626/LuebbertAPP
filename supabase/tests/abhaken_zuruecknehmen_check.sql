-- Assertions for migration abhaken_zuruecknehmen. Run only inside a transaction that is rolled back (after the migration body).
do $$
declare v_al uuid := gen_random_uuid(); q numeric; ok boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values (v_al, 'ZZ AZ AL', 'AL', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_al, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.order_checks (list_key, phase, item_key, qty, plan_date) values ('job:99-0002.01', 'aufbau', '0.0', 5, current_date);
  -- take it back
  insert into public.order_checks (list_key, phase, item_key, qty, plan_date) values ('job:99-0002.01', 'aufbau', '0.0', null, current_date)
    on conflict (list_key, phase, item_key) do update set qty = excluded.qty, changed_at = excluded.changed_at;
  select qty into q from public.order_checks where list_key = 'job:99-0002.01';
  if q is not null then raise exception 'tick not taken back, qty = %', q; end if;
  -- an older offline tick does not bring it back
  insert into public.order_checks (list_key, phase, item_key, qty, plan_date, changed_at) values ('job:99-0002.01', 'aufbau', '0.0', 5, current_date, now() - interval '1 hour')
    on conflict (list_key, phase, item_key) do update set qty = excluded.qty, changed_at = excluded.changed_at;
  select qty into q from public.order_checks where list_key = 'job:99-0002.01';
  if q is not null then raise exception 'older tick won, qty = %', q; end if;
  -- negative still refused
  ok := false; begin insert into public.order_checks (list_key, phase, item_key, qty, plan_date) values ('job:99-0002.01', 'aufbau', '0.1', -1, current_date);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'negative qty accepted'; end if;
  reset role;
  raise notice 'abhaken_zuruecknehmen_check: ok';
end $$;
