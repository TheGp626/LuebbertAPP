-- Rollback of 20261209_nachgetragen_sperre. Deploy an app version without the Freigabe first (it reads the columns).
drop trigger if exists shifts_self_entry_guard on public.shifts;
drop function if exists public.shifts_self_entry_guard();
alter table public.shifts drop column if exists approved_at, drop column if exists approved_by, drop column if exists self_entered;
