-- One person can't be in two protocols at the same time: a double send / copied crew (Paul, 23.+25.11.2026) would pay
-- every hour twice. Rejects a protocol shift that overlaps another protocol's shift of the same user (same-minute
-- handover 17:00-17:00 is fine). Temp workers (no user_id) and shifts without date/times are not checked.
-- Rollback: supabase/rollback/20261207_shift_overlap_guard_rollback.sql. Check: supabase/tests/shift_overlap_check.sql.

create or replace function public.shifts_overlap_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare o record;
begin
  if new.protocol_id is null or new.user_id is null
     or new.shift_date is null or new.start_time is null or new.end_time is null then
    return new;
  end if;
  select s.start_time, s.end_time, s.shift_date, coalesce(p.job_no, pr.name, 'ohne Nummer') as what into o
    from public.shifts s
    join public.protocols p on p.id = s.protocol_id
    left join public.projects pr on pr.id = p.project_id
   where s.user_id = new.user_id
     and s.protocol_id <> new.protocol_id
     and s.id is distinct from new.id
     and s.shift_date between new.shift_date - 1 and new.shift_date + 1
     and s.start_time is not null and s.end_time is not null
     and public.shift_span(s.shift_date, s.start_time, s.end_time) && public.shift_span(new.shift_date, new.start_time, new.end_time)
   limit 1;
  if found then
    raise exception 'Doppelte Schicht: % ist am % schon von % bis % in einem anderen Protokoll (%) eingetragen.',
      (select full_name from public.app_users where id = new.user_id), to_char(o.shift_date, 'DD.MM.'),
      to_char(o.start_time, 'HH24:MI'), to_char(o.end_time, 'HH24:MI'), o.what
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function public.shifts_overlap_guard() from public, anon, authenticated;

drop trigger if exists shifts_overlap_guard on public.shifts;
create trigger shifts_overlap_guard before insert or update of protocol_id, user_id, shift_date, start_time, end_time on public.shifts
  for each row execute function public.shifts_overlap_guard();
