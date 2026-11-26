-- Check of 20261211_protokoll_verlauf (run after the migration; always rolls back).
do $$
declare pl uuid; ma uuid; p uuid; s uuid; c record; n int;
begin
  select id into pl from public.app_users where role = 'PL' and is_active is not false limit 1;
  select id into ma from public.app_users where role = 'MA' and is_active is not false limit 1;
  select id into p from public.protocols where created_at < now() - interval '1 day' and exists (select 1 from public.shifts x where x.protocol_id = protocols.id and x.start_time is not null) order by created_at desc limit 1;
  select id into s from public.shifts where protocol_id = p and start_time is not null limit 1;
  delete from public.protocol_changes where protocol_id = p;
  update public.protocols set mailed_at = null, first_mailed_at = null, changed_after_mail_at = null where id = p;
  perform set_config('request.jwt.claims', json_build_object('sub', pl, 'role', 'authenticated')::text, true);

  update public.shifts set end_time = end_time + interval '30 minutes', status = status where id = s;
  select * into c from public.protocol_changes where protocol_id = p order by id desc limit 1;
  if c.table_name <> 'shifts' or c.action <> 'update' or not (c.old_values ? 'end_time') or c.changed_by <> pl or c.subject is null then raise exception 'shift change not logged: %', row_to_json(c); end if;
  if (select changed_after_mail_at from public.protocols where id = p) is not null then raise exception 'marked before any mail'; end if;
  -- Anwesenheit: status is content there
  perform public.set_protocol_attendance(p, jsonb_build_array(jsonb_build_object('user_id', ma, 'status', 'krank')));
  perform public.set_protocol_attendance(p, jsonb_build_array(jsonb_build_object('user_id', ma, 'status', 'abgesagt')));
  select * into c from public.protocol_changes where protocol_id = p order by id desc limit 1;
  if c.table_name <> 'protocol_attendance' or c.old_values ->> 'status' <> 'krank' then raise exception 'attendance change not logged'; end if;

  -- only bookkeeping changed → nothing logged
  select count(*) into n from public.protocol_changes where protocol_id = p;
  update public.shifts set status = case when status = 'offen' then 'offen' else status end where id = s;
  if (select count(*) from public.protocol_changes where protocol_id = p) <> n then raise exception 'noise logged'; end if;

  -- after the first mail every change marks the protocol
  perform set_config('request.jwt.claims', '', true);
  update public.protocols set mailed_at = now() - interval '1 hour' where id = p;
  if (select first_mailed_at from public.protocols where id = p) is null then raise exception 'first_mailed_at not set'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', pl, 'role', 'authenticated')::text, true);
  update public.protocols set notes_feedback = coalesce(notes_feedback, '') || ' (korrigiert)' where id = p;
  if (select changed_after_mail_at from public.protocols where id = p) is null then raise exception 'nach Versand geändert not set'; end if;
  perform set_config('request.jwt.claims', '', true);
  update public.protocols set mailed_at = now() where id = p;
  if (select first_mailed_at from public.protocols where id = p) > now() - interval '30 minutes' then raise exception 'first_mailed_at moved'; end if;
  raise exception 'OK (rolled back)';
end $$;
