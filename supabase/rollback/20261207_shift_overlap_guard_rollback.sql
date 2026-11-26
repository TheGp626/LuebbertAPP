-- Rollback of 20261207_shift_overlap_guard.
drop trigger if exists shifts_overlap_guard on public.shifts;
drop function if exists public.shifts_overlap_guard();
