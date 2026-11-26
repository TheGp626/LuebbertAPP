-- Check of 20261209_nachgetragen_sperre (run after the migration; always rolls back).
do $$
declare ma uuid; adm uuid; s1 uuid; s2 uuid; today date := (now() at time zone 'Europe/Berlin')::date; ok boolean; rec record;
begin
  select id into ma from public.app_users where role = 'MA' and is_active is not false limit 1;
  select id into adm from public.app_users where role = 'Admin' and is_active is not false limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', ma, 'role', 'authenticated')::text, true);

  -- today: open from the start time on, locked before it (needs a run between 00:30 and 23:30 Berlin)
  insert into public.shifts (user_id, position_role, shift_date, start_time, end_time, status) values (ma, 'MA Minijob', today, '00:05', '00:20', 'offen');
  ok := false;
  begin
    insert into public.shifts (user_id, position_role, shift_date, start_time, end_time, status) values (ma, 'MA Minijob', today, '23:45', '23:55', 'offen');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'later today was not locked'; end if;
  ok := false;
  begin
    insert into public.shifts (user_id, position_role, shift_date, start_time, end_time, status) values (ma, 'MA Minijob', today + 1, '08:00', '09:00', 'offen');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'tomorrow was not locked'; end if;

  insert into public.shifts (user_id, position_role, shift_date, start_time, end_time, status, approved_at, self_entered)
    values (ma, 'MA Minijob', today - 3, '08:00', '12:00', 'offen', now(), false) returning id into s1;
  select * into rec from public.shifts where id = s1;
  if not rec.self_entered then raise exception 'not marked nachgetragen'; end if;
  if rec.approved_at is not null then raise exception 'MA approved own shift'; end if;
  insert into public.shifts (user_id, position_role, shift_date, start_time, end_time, status) values (ma, 'MA Minijob', today - 2, '08:00', '12:00', 'offen') returning id into s2;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  ok := false;
  begin
    update public.shifts set status = 'eingetragen' where id = s2;
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'unapproved shift was booked'; end if;
  update public.shifts set approved_at = now() where id = s1;
  select * into rec from public.shifts where id = s1;
  if rec.approved_by is distinct from adm then raise exception 'approval not stamped'; end if;
  update public.shifts set status = 'eingetragen' where id = s1;
  -- Admin's own entries for today stay possible and unmarked
  insert into public.shifts (user_id, position_role, shift_date, start_time, end_time, status) values (adm, 'MA Fest', today, '08:00', '09:00', 'offen') returning id into s2;
  if (select self_entered from public.shifts where id = s2) then raise exception 'Admin entry marked'; end if;
  raise exception 'OK (rolled back)';
end $$;
