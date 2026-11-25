-- Assertions for migration planen_flow. Run only inside a transaction that is rolled back (after the migration body).
do $$
declare v_plan uuid := gen_random_uuid(); v_ma uuid := gen_random_uuid(); v_folder uuid; v_file uuid; n int; ok boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active, plans_week, plan_interest_viewer)
    values (v_plan, 'ZZ PF Plan', 'MA', true, true, true), (v_ma, 'ZZ PF MA', 'MA', true, false, false);
  insert into public.project_folders (name) values ('ZZ PF Ordner') returning id into v_folder;
  insert into public.folder_files (folder_id, name, file_url, file_type) values (v_folder, 'ZZ Auftragsbestätigung.pdf', 'x/zz.pdf', 'application/pdf') returning id into v_file;
  insert into public.order_parsed (file_id, parser_version, result) values (v_file, 99,
    jsonb_build_object('title', '991231_ZZort_Test', 'jobs', jsonb_build_array(jsonb_build_object('jobNo', '99-9999.01', 'name', 'ZZ Job',
      'setup', jsonb_build_object('start', to_char(current_date + 3, 'YYYY-MM-DD') || 'T07:00', 'end', to_char(current_date + 3, 'YYYY-MM-DD') || 'T16:00')))));

  -- planner sees the phase without an MA number, an MA does not, order_slots() still hides it
  perform set_config('request.jwt.claims', json_build_object('sub', v_plan, 'role', 'authenticated')::text, true);
  select count(*) into n from public.planner_order_phases() where job_no = '99-9999.01';
  if n <> 1 then raise exception 'planner sees % phases', n; end if;
  select count(*) into n from public.order_slots() where job_no = '99-9999.01';
  if n <> 0 then raise exception 'order_slots shows a phase without MA'; end if;
  -- the planner may set the number (RLS)
  set local role authenticated;
  insert into public.order_staffing (job_no, staff_setup) values ('99-9999.01', 3);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  select count(*) into n from public.planner_order_phases();
  if n <> 0 then raise exception 'MA sees planner phases'; end if;
  set local role authenticated;
  ok := false; begin update public.order_staffing set staff_setup = 9 where job_no = '99-9999.01';
    get diagnostics n = row_count; ok := n = 0; exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'MA could change MA numbers'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'plan_draft_shifts' and column_name = 'manual') then raise exception 'manual missing'; end if;
  raise notice 'planen_flow_check: ok';
end $$;
