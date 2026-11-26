-- Rollback of 20261210_anwesenheit (the statuses are lost).
drop function if exists public.attendance_alerts(integer);
drop function if exists public.set_protocol_attendance(uuid, jsonb);
drop table if exists public.protocol_attendance;
