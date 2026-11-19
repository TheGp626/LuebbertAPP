-- Rollback of 20261118_zusatzauftrag. Zusatz protocols become normal ones without crew (cost stays 0).
drop trigger if exists shifts_side_guard on public.shifts;
drop function if exists public.shifts_side_guard();
alter table public.protocols drop column if exists side_of;
