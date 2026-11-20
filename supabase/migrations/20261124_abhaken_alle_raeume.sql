-- Material abhaken: all rooms of one Auftragsbestätigung in one list (26-0287.01 CH II, .02 Saal Europa, .03 Foyer 4).
-- The plan links one job, and order_slots() only knows jobs with an MA number, so the app could not see the other rooms.
-- order_check_group(p_job, p_phase) returns positions (quantity + name) of every job in the same Bestätigung whose
-- phase (setup/teardown) starts on the same day as p_job's. Same right as order_check_items(p_job): whoever may tick
-- that job may see its sister rooms of that day (writing still goes through order_check_mine with the plan keys).
-- Rollback: drop function public.order_check_group(text, text);
create or replace function public.order_check_group(p_job text, p_phase text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; role text := public.app_role(); fid uuid; day text;
begin
  if p_job is null or p_job !~ '^[0-9]{2}-[0-9]{4}\.[0-9]{2}$' or p_phase not in ('setup', 'teardown') then return null; end if;
  if not (role in ('AL', 'PL', 'Buchhaltung', 'Admin') or (role = 'MA' and public.order_check_mine('job:' || p_job, '{}'))) then
    raise exception 'not_allowed' using errcode = 'insufficient_privilege';
  end if;
  -- the newest Bestätigung that holds the job, and the day of its phase
  select op.file_id, left((j -> p_phase) ->> 'start', 10) into fid, day
    from public.order_parsed op
    join public.folder_files f on f.id = op.file_id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(op.result -> 'jobs') = 'array' then op.result -> 'jobs' else '[]'::jsonb end) j
   where j ->> 'jobNo' = p_job
   order by f.created_at desc, op.parsed_at desc
   limit 1;
  if fid is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'jobNo', j ->> 'jobNo',
      'name', coalesce(j ->> 'name', ''),
      'materials', coalesce((select jsonb_agg(jsonb_build_object('group', coalesce(g ->> 'group', ''),
          'items', coalesce((select jsonb_agg(jsonb_build_object('qty', it -> 'qty', 'name', it ->> 'name'))
                             from jsonb_array_elements(case when jsonb_typeof(g -> 'items') = 'array' then g -> 'items' else '[]'::jsonb end) it), '[]'::jsonb)))
        from jsonb_array_elements(case when jsonb_typeof(j -> 'materials') = 'array' then j -> 'materials' else '[]'::jsonb end) g), '[]'::jsonb))
      order by j ->> 'jobNo'), '[]'::jsonb)
    into r
    from public.order_parsed op
    cross join lateral jsonb_array_elements(case when jsonb_typeof(op.result -> 'jobs') = 'array' then op.result -> 'jobs' else '[]'::jsonb end) j
   where op.file_id = fid
     and split_part(j ->> 'jobNo', '.', 1) = split_part(p_job, '.', 1)
     and (j ->> 'jobNo' = p_job or (day is not null and left((j -> p_phase) ->> 'start', 10) = day));
  return r;
end $$;
revoke execute on function public.order_check_group(text, text) from public, anon;
grant execute on function public.order_check_group(text, text) to authenticated, service_role;
