-- Material abhaken: a tick can be taken back. qty null = position open again (the row stays, so the newest change
-- still wins over an older offline change and every phone gets the update through Realtime).
-- Rollback: supabase/rollback/20261119_abhaken_zuruecknehmen_rollback.sql. Check: supabase/tests/abhaken_zuruecknehmen_check.sql.
alter table public.order_checks alter column qty drop not null;
