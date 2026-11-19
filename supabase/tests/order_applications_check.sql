-- Assertions for migration order_applications. Run only inside a transaction that is rolled back (after the migration body);
-- raises on the first failed check. Temporary users/folders 'ZZ OA …' disappear with the rollback.
do $$
declare
  v_pl uuid := gen_random_uuid();
  v_ma uuid := gen_random_uuid();
  v_ma2 uuid := gen_random_uuid();
  v_gast uuid := gen_random_uuid();
  v_folder uuid; v_file uuid; n int; ok boolean; r record;
  d text := to_char(current_date + 2, 'YYYY-MM-DD');
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values
    (v_pl, 'ZZ OA PL', 'PL', true), (v_ma, 'ZZ OA MA', 'MA', true), (v_ma2, 'ZZ OA MA2', 'MA', true), (v_gast, 'ZZ OA Gast', 'Gast', true);
  insert into public.project_folders (name, created_by) values ('ZZ OA Ordner', v_pl) returning id into v_folder;
  insert into public.folder_files (folder_id, name, file_url, created_by) values (v_folder, 'ZZ Auftragsbestaetigung.pdf', 'x/zz.pdf', v_pl) returning id into v_file;
  insert into public.order_parsed (file_id, parser_version, result) values (v_file, 3, jsonb_build_object('title', '261112_Estrel_ZZ Test',
    'jobs', jsonb_build_array(jsonb_build_object('jobNo', '99-9999.01', 'name', 'ZZ Job', 'room', 'Saal', 'address', 'Geheimstr. 1',
      'setup', jsonb_build_object('start', d || 'T10:00', 'end', d || 'T18:00'), 'teardown', null,
      'materials', '[{"group":"Bar","items":[{"qty":2,"name":"Bar"}]}]'::jsonb, 'notes', 'Info'),
      -- impossible date from a bad parse must not break order_slots() for everyone
      jsonb_build_object('jobNo', '99-9999.02', 'name', 'ZZ kaputt', 'setup', jsonb_build_object('start', '2099-02-30T10:00')))));
  insert into public.order_staffing (job_no, staff_setup, staff_teardown) values ('99-9999.01', 3, 2), ('99-9999.02', 1, 0);
  insert into public.order_applications (job_no, phase, user_id) values ('99-9999.01', 'setup', v_ma2);

  -- ── MA ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.order_applications (job_no, phase, user_id, decided_by, decided_at, created_at)
    values ('99-9999.01', 'setup', v_ma, v_pl, now() - interval '1 day', now() - interval '9 days');
  select count(*) into n from public.order_applications where user_id = v_ma and decided_by is null and decided_at is null and created_at > now() - interval '1 minute';
  if n <> 1 then raise exception 'MA forged decided_by / created_at'; end if;
  select count(*) into n from public.order_applications;
  if n <> 1 then raise exception 'MA sees other applications (%)', n; end if;
  ok := false; begin insert into public.order_applications (job_no, phase, user_id) values ('99-9999.01', 'teardown', v_ma2);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA applied for someone else'; end if;
  ok := false; begin insert into public.order_applications (job_no, phase, user_id, status) values ('99-9999.01', 'teardown', v_ma, 'angenommen');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA inserted himself as angenommen'; end if;
  update public.order_applications set status = 'angenommen' where user_id = v_ma;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'MA accepted himself'; end if;
  select * into r from public.order_slots() where job_no = '99-9999.01';
  if r.job_no is distinct from '99-9999.01' or r.needed <> 3 or r.my_status is distinct from 'offen' or r.materials->0->>'group' <> 'Bar' or r.link_set then
    raise exception 'order_slots for MA wrong: %', row_to_json(r);
  end if;
  select count(*) into n from public.order_slots() where job_no = '99-9999.01';
  if n <> 1 then raise exception 'teardown with null time or other rows listed (%)', n; end if;
  ok := false; begin insert into public.order_plan_links (job_no, phase, plan_date, plan_key) values ('99-9999.01', 'setup', null, null);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA wrote a plan link'; end if;
  ok := false; begin perform 1 from public.order_parsed; select count(*) into n from public.order_parsed;
    if n = 0 then ok := true; end if;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA reads order_parsed'; end if;

  -- ── Gast ──
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_gast, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin insert into public.order_applications (job_no, phase, user_id) values ('99-9999.01', 'setup', v_gast);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'Gast applied'; end if;
  select count(*) into n from public.order_slots();
  if n <> 0 then raise exception 'Gast sees slots'; end if;

  -- ── PL ──
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pl, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.order_applications set status = 'angenommen' where user_id = v_ma and job_no = '99-9999.01';
  select count(*) into n from public.order_applications where user_id = v_ma and status = 'angenommen' and decided_by = v_pl and decided_at is not null;
  if n <> 1 then raise exception 'PL accept / decided_by failed'; end if;
  insert into public.order_plan_links (job_no, phase, plan_date, plan_key) values ('99-9999.01', 'setup', current_date + 2, 'k1');
  ok := false; begin insert into public.order_plan_links (job_no, phase, plan_date, plan_key) values ('99-9999.01', 'teardown', current_date, null);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'half link accepted'; end if;
  select * into r from public.order_slots() where job_no = '99-9999.01';
  if r.accepted <> 1 or r.accepted_ids <> array[v_ma] or not r.link_set or r.link_key <> 'k1' then raise exception 'order_slots for PL wrong: %', row_to_json(r); end if;

  -- ── MA can't withdraw an accepted application ──
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.order_applications where user_id = v_ma;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'MA deleted an accepted application'; end if;
  reset role;
  raise notice 'order_applications checks passed';
end $$;
