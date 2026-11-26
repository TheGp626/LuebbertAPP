-- Check of 20261210_anwesenheit (run after the migration; always rolls back).
do $$
declare al uuid; ma uuid; adm uuid; p uuid; n int; t timestamptz;
begin
  select id into al from public.app_users where role = 'AL' and is_active is not false limit 1;
  select id into ma from public.app_users where role = 'MA' and is_active is not false limit 1;
  select id into adm from public.app_users where role = 'Admin' and is_active is not false limit 1;
  select id into p from public.protocols order by created_at desc limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', ma, 'role', 'authenticated')::text, true);
  begin
    perform public.set_protocol_attendance(p, '[]'::jsonb);
    raise exception 'MA may set attendance';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', al, 'role', 'authenticated')::text, true);
  n := public.set_protocol_attendance(p, jsonb_build_array(
    jsonb_build_object('user_id', ma, 'status', 'krank'),
    jsonb_build_object('name', ' Zed ', 'status', 'nicht_erschienen')));
  if n <> 2 then raise exception 'expected 2 rows, got %', n; end if;
  update public.protocol_attendance set alerted_at = now() where protocol_id = p;
  -- same list again: alerted_at stays; Zed with other case keeps the row
  n := public.set_protocol_attendance(p, jsonb_build_array(
    jsonb_build_object('user_id', ma, 'status', 'krank'),
    jsonb_build_object('name', 'zed', 'status', 'nicht_erschienen')));
  if exists (select 1 from public.protocol_attendance where protocol_id = p and alerted_at is null) then raise exception 'alerted_at lost'; end if;
  -- status change resets the alert, a removed person goes
  n := public.set_protocol_attendance(p, jsonb_build_array(jsonb_build_object('user_id', ma, 'status', 'abgesagt')));
  if n <> 1 then raise exception 'removed row stayed'; end if;
  if (select alerted_at from public.protocol_attendance where protocol_id = p) is not null then raise exception 'changed status kept alert'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.attendance_alerts(14) a where a.protocol_id = p and a.status = 'abgesagt') then raise exception 'Admin does not see the Ausfall'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', al, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.attendance_alerts(14)) and not (select plan_interest_viewer from public.app_users where id = al) then raise exception 'AL sees alerts'; end if;
  raise exception 'OK (rolled back)';
end $$;
