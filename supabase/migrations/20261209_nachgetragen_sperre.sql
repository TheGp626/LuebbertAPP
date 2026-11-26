-- Stundenzettel nur rückwirkend (Jenni, Briefing 26.11.2026, Priorität 1):
-- 1. Own manual shifts (no protocol) of everyone but Admin, PL and Buchhaltung can only be entered up to today (Berlin).
--    Tomorrow and later are locked: the AL's protocol is the source of the hours.
-- 2. Such shifts are marked shifts.self_entered ("nachgetragen") by the server and need a Freigabe
--    (approved_by / approved_at) by Admin or PL before they can be booked ('eingetragen').
--    Changing date or times of a nachgetragen shift as non-office clears the Freigabe.
-- Old shifts stay unmarked. Rollback: supabase/rollback/20261209_nachgetragen_sperre_rollback.sql.
-- Check: supabase/tests/nachgetragen_sperre_check.sql.

alter table public.shifts
  add column if not exists self_entered boolean not null default false,
  add column if not exists approved_by uuid references public.app_users(id) on delete set null,
  add column if not exists approved_at timestamptz;

create or replace function public.shifts_self_entry_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  r text;
  office boolean;
  today date := (now() at time zone 'Europe/Berlin')::date;
  moved boolean;
begin
  if auth.uid() is null or claims ->> 'role' = 'service_role' then return new; end if;
  r := public.app_role();
  office := r in ('Admin', 'PL', 'Buchhaltung');
  moved := tg_op = 'INSERT' or new.shift_date is distinct from old.shift_date
           or new.start_time is distinct from old.start_time or new.end_time is distinct from old.end_time;

  -- 1. Lock: own manual shifts only up to today
  if not office and new.user_id = auth.uid() and new.protocol_id is null and moved
     and (new.shift_date is null or new.shift_date > today) then
    raise exception 'Schichten kannst du nur bis heute nachtragen. Zukünftige Zeiten trägt die AL im Protokoll ein.'
      using errcode = 'check_violation';
  end if;

  -- 2. Marker, set only here
  if tg_op = 'INSERT' then
    new.self_entered := not office and new.user_id = auth.uid() and new.protocol_id is null;
  else
    new.self_entered := old.self_entered and new.protocol_id is null;
  end if;

  -- Freigabe: only Admin and PL set it; it is stamped with the person
  if r not in ('Admin', 'PL') then
    if tg_op = 'INSERT' then
      new.approved_by := null; new.approved_at := null;
    elsif moved and new.self_entered then
      new.approved_by := null; new.approved_at := null;
    else
      new.approved_by := old.approved_by; new.approved_at := old.approved_at;
    end if;
  elsif new.approved_at is not null and (tg_op = 'INSERT' or old.approved_at is null) then
    new.approved_by := auth.uid();
  elsif new.approved_at is null then
    new.approved_by := null;
  end if;

  -- Booking a nachgetragen shift needs the Freigabe first
  if new.status = 'eingetragen' and new.self_entered and new.approved_at is null
     and (tg_op = 'INSERT' or old.status is distinct from 'eingetragen') then
    raise exception 'Nachgetragene Schicht: erst freigeben, dann verbuchen.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function public.shifts_self_entry_guard() from public, anon, authenticated;

drop trigger if exists shifts_self_entry_guard on public.shifts;
create trigger shifts_self_entry_guard before insert or update on public.shifts
  for each row execute function public.shifts_self_entry_guard();
