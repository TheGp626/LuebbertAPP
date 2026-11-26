-- Rollback of 20261211_protokoll_verlauf (the history is lost).
drop trigger if exists log_protocol_change on public.protocols;
drop trigger if exists log_protocol_change on public.shifts;
drop trigger if exists log_protocol_change on public.protocol_transports;
drop trigger if exists log_protocol_change on public.protocol_equipments;
drop trigger if exists log_protocol_change on public.protocol_attendance;
drop trigger if exists protocols_first_mail on public.protocols;
drop trigger if exists protocols_drop_changes on public.protocols;
drop function if exists public.log_protocol_change();
drop function if exists public.protocols_first_mail();
drop function if exists public.protocols_drop_changes();
drop function if exists public.protocol_change_noise(text);
drop table if exists public.protocol_changes;
alter table public.protocols drop column if exists changed_after_mail_at, drop column if exists first_mailed_at;
