-- A protocol shift replaces the worker's own (manual) shifts that overlap it — on the server,
-- right when the protocol is saved. Before this, only the worker's phone dropped the manual
-- shift (dropOverriddenShifts) and the server copy stayed until the worker saved the week again
-- → double hours in the dashboard/billing (Adriano, 2026-11-04).
-- Only status 'offen' manual rows of the same user are deleted; booked ('eingetragen') rows stay.

create or replace function public.shift_span(d date, s time, e time)
returns tsrange language sql immutable as $$
  select tsrange(d + s, case when e < s then d + 1 + e else d + e end, '[)')
$$;

create or replace function public.protocol_shift_replaces_own()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.protocol_id is null or new.user_id is null
     or new.shift_date is null or new.start_time is null or new.end_time is null then
    return new;
  end if;
  delete from public.shifts m
   where m.user_id = new.user_id
     and m.protocol_id is null
     and m.status = 'offen'
     and m.shift_date between new.shift_date - 1 and new.shift_date + 1
     and m.start_time is not null and m.end_time is not null
     and public.shift_span(m.shift_date, m.start_time, m.end_time)
         && public.shift_span(new.shift_date, new.start_time, new.end_time);
  return new;
end $$;

revoke all on function public.protocol_shift_replaces_own() from public, anon, authenticated;

drop trigger if exists protocol_shift_replaces_own on public.shifts;
create trigger protocol_shift_replaces_own
  after insert or update of protocol_id, user_id, shift_date, start_time, end_time on public.shifts
  for each row execute function public.protocol_shift_replaces_own();

-- Existing doubles: the cleanup below was run once by hand on 2026-11-05 (Patryk's OK) and deleted
-- 23 rows (June–Nov); the deleted rows are saved in backups/2026-11-05/deleted_double_shifts.json.
-- delete from public.shifts m
--  using public.shifts p
--  where p.protocol_id is not null and m.protocol_id is null
--    and m.status = 'offen' and m.user_id = p.user_id
--    and m.shift_date between p.shift_date - 1 and p.shift_date + 1
--    and m.start_time is not null and m.end_time is not null
--    and p.start_time is not null and p.end_time is not null
--    and public.shift_span(m.shift_date, m.start_time, m.end_time)
--        && public.shift_span(p.shift_date, p.start_time, p.end_time);
