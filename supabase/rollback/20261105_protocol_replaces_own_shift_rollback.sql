-- Rollback for 20261105_protocol_replaces_own_shift.sql (manual shifts deleted by the trigger are NOT restored)
drop trigger if exists protocol_shift_replaces_own on public.shifts;
drop function if exists public.protocol_shift_replaces_own();
drop function if exists public.shift_span(date, time, time);
