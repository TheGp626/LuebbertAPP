-- Assertions for migration material_abhaken. Run only inside a transaction that is rolled back (after the migration body).
do $$
declare v_ma uuid := gen_random_uuid(); v_ma2 uuid := gen_random_uuid(); v_al uuid := gen_random_uuid(); v_pl uuid := gen_random_uuid();
  v_bh uuid := gen_random_uuid(); v_gast uuid := gen_random_uuid(); v_week uuid := gen_random_uuid(); v_shift uuid := gen_random_uuid();
  v_folder uuid := gen_random_uuid(); v_file uuid := gen_random_uuid(); ok boolean; n int; r jsonb; q numeric;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values
    (v_ma, 'ZZ MAB MA', 'MA', true), (v_ma2, 'ZZ MAB MA2', 'MA', true), (v_al, 'ZZ MAB AL', 'AL', true), (v_pl, 'ZZ MAB PL', 'PL', true),
    (v_bh, 'ZZ MAB BH', 'Buchhaltung', true), (v_gast, 'ZZ MAB Gast', 'Gast', true);
  insert into public.plan_weeks (id, year, kw, week_start, week_end) values (v_week, 2099, 53, current_date - 3, current_date + 3);
  insert into public.plan_shifts (id, week_id, date, key, title) values (v_shift, v_week, current_date, 'zzkey', 'ZZ Gala');
  insert into public.plan_assignments (shift_id, user_id, name) values (v_shift, v_ma, 'ZZ MAB MA');
  insert into public.order_plan_links (job_no, phase, plan_date, plan_key) values ('99-0001.01', 'setup', current_date, 'zzkey');
  insert into public.project_folders (id, name) values (v_folder, 'ZZ MAB Ordner');
  insert into public.folder_files (id, folder_id, name, file_url) values (v_file, v_folder, 'zz.pdf', 'x');
  insert into public.order_parsed (file_id, parser_version, result) values (v_file, 6,
    '{"project": "99-0001", "jobs": [{"jobNo": "99-0001.01", "name": "Gala", "lead": "Geheim", "materials": [{"group": "Mobiliar", "items": [{"qty": 10, "name": "Stuhl", "price": 5}]}]}]}');

  -- AL ticks a position; updated_by and server time are set by the server
  perform set_config('request.jwt.claims', json_build_object('sub', v_al, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.order_checks (list_key, phase, item_key, item_name, soll, qty, plan_date, plan_keys)
    values ('job:99-0001.01', 'aufbau', '0.0', 'Stuhl', 10, 8, current_date, array['zzkey']);
  -- a foreign updated_by is replaced by the caller's id
  insert into public.order_checks (list_key, phase, item_key, qty, plan_date, updated_by)
    values ('job:99-0001.01', 'aufbau', '0.1', 1, current_date, v_pl);
  ok := false; begin insert into public.order_checks (list_key, phase, item_key, qty, plan_date) values ('job:99-0001.01', 'mitte', 'x', 1, current_date);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'unknown phase accepted'; end if;
  ok := false; begin insert into public.order_checks (list_key, phase, item_key, qty, plan_date) values ('foo', 'aufbau', 'x', 1, current_date);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'bad list_key accepted'; end if;
  -- AL reads the positions of the job: quantity and name only
  r := public.order_check_items('99-0001.01');
  if r -> 'materials' -> 0 -> 'items' -> 0 ->> 'name' <> 'Stuhl' or (r -> 'materials' -> 0 -> 'items' -> 0 ->> 'qty')::int <> 10 then raise exception 'items wrong: %', r; end if;
  if r::text like '%Geheim%' or r::text like '%price%' then raise exception 'items leak more than qty + name: %', r; end if;
  if public.order_check_items('99-0009.01') is not null then raise exception 'unknown job returned items'; end if;
  reset role;
  if (select updated_by from public.order_checks where item_key = '0.0') <> v_al then raise exception 'updated_by not set'; end if;
  if (select updated_by from public.order_checks where item_key = '0.1') <> v_al then raise exception 'foreign updated_by kept'; end if;
  delete from public.order_checks where item_key = '0.1';

  -- planned MA sees and corrects it; an older offline change does not overwrite a newer one
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.order_checks where list_key = 'job:99-0001.01';
  if n <> 1 then raise exception 'planned MA sees % rows', n; end if;
  insert into public.order_checks (list_key, phase, item_key, item_name, soll, qty, plan_date, plan_keys)
    values ('job:99-0001.01', 'aufbau', '0.0', 'Stuhl', 10, 9, current_date, array['zzkey'])
    on conflict (list_key, phase, item_key) do update set qty = excluded.qty, changed_at = excluded.changed_at, plan_keys = excluded.plan_keys;
  insert into public.order_checks (list_key, phase, item_key, item_name, soll, qty, plan_date, plan_keys, changed_at)
    values ('job:99-0001.01', 'aufbau', '0.0', 'Stuhl', 10, 1, current_date, array['zzkey'], now() - interval '1 hour')
    on conflict (list_key, phase, item_key) do update set qty = excluded.qty, changed_at = excluded.changed_at, plan_keys = excluded.plan_keys;
  r := public.order_check_items('99-0001.01');
  if r is null then raise exception 'planned MA cannot read items'; end if;
  -- a plan list of the own Einsatz
  insert into public.order_checks (list_key, phase, item_key, item_name, soll, qty, plan_date, plan_keys)
    values ('plan:2099-01-01|zz gala', 'aufbau', 'p0', '6 Flatsofa', 6, 6, current_date, array['zzkey']);
  -- PL-only delete
  delete from public.order_checks where list_key = 'job:99-0001.01'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'MA could delete'; end if;
  reset role;
  select qty into q from public.order_checks where list_key = 'job:99-0001.01' and item_key = '0.0';
  if q <> 9 then raise exception 'last-change-wins broken, qty = %', q; end if;

  -- MA not planned: sees nothing, writes nothing, reads no items
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.order_checks where list_key like 'job:99-%' or list_key like 'plan:2099-%';
  if n <> 0 then raise exception 'unplanned MA sees % rows', n; end if;
  ok := false; begin insert into public.order_checks (list_key, phase, item_key, qty, plan_date, plan_keys)
    values ('job:99-0001.01', 'abbau', '0.0', 1, current_date, array['zzkey']);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'unplanned MA could write'; end if;
  ok := false; begin perform public.order_check_items('99-0001.01'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'unplanned MA read items'; end if;
  reset role;

  -- Buchhaltung reads, cannot write; Gast nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_bh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.order_checks where list_key = 'job:99-0001.01';
  if n <> 1 then raise exception 'Buchhaltung sees % rows', n; end if;
  ok := false; begin insert into public.order_checks (list_key, phase, item_key, qty, plan_date) values ('job:99-0001.01', 'abbau', 'b', 1, current_date);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'Buchhaltung could write'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_gast, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.order_checks where list_key = 'job:99-0001.01';
  if n <> 0 then raise exception 'Gast sees rows'; end if;
  ok := false; begin perform public.order_check_items('99-0001.01'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'Gast read items'; end if;
  reset role;

  -- PL may start a list over
  perform set_config('request.jwt.claims', json_build_object('sub', v_pl, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.order_checks where list_key = 'plan:2099-01-01|zz gala'; get diagnostics n = row_count;
  if n <> 1 then raise exception 'PL could not delete'; end if;
  reset role;

  -- shortages column and realtime
  ok := false; begin
    insert into public.protocols (date, shortages) values ('2099-01-01', '{"x": 1}');
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'shortages accepted an object'; end if;
  insert into public.protocols (date, shortages) values ('2099-01-01', '[{"name": "Stuhl", "fehlt": 2}]');
  select count(*) into n from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('order_checks', 'protocols', 'shifts');
  if n <> 3 then raise exception 'realtime publication has % of 3 tables', n; end if;

  -- anon gets nothing
  set local role anon;
  ok := false; begin perform 1 from public.order_checks; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'anon can read order_checks'; end if;
  ok := false; begin perform public.order_check_items('99-0001.01'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'anon can call order_check_items'; end if;
  reset role;
  raise notice 'material_abhaken_check: ok';
end $$;
