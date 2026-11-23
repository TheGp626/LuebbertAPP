-- Check of 20261129_job_floorplans.sql (run after it is applied). Always rolls back: the last line raises.
do $$
declare pl uuid; ma uuid; fid uuid; n int; failed boolean;
begin
  select id into pl from public.app_users where role = 'PL' and is_active is not false order by id limit 1;
  select id into ma from public.app_users where role = 'MA' and is_active is not false order by id limit 1;
  if pl is null or ma is null then raise exception 'need one active PL and one MA'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', pl, 'role', 'authenticated')::text, true);
  insert into public.job_floorplans (job_no, title, room, date_from, date_to, file_path, result)
    values ('26-0447.01', 'Check', 'Foyer 3', '2026-11-24', '2026-11-25', 'floorplans/check.pdf', '{"groups":[]}') returning id into fid;
  perform set_config('request.jwt.claims', json_build_object('sub', ma, 'role', 'authenticated')::text, true);
  select count(*) into n from public.job_floorplans where id = fid;
  if n <> 1 then raise exception 'MA must see the plan'; end if;
  failed := false;
  begin insert into public.job_floorplans (title, file_path) values ('x', 'floorplans/x.pdf'); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'MA must not save plans'; end if;
  update public.job_floorplans set title = 'hack' where id = fid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'MA must not change plans'; end if;
  failed := false;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', pl, 'role', 'authenticated')::text, true);
    insert into public.job_floorplans (title, file_path) values ('x', '../etc/passwd');
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'file_path outside floorplans/ must fail'; end if;
  raise exception 'ALL CHECKS PASSED (rolled back)';
end $$;
