-- Rollback of 20261119_abhaken_zuruecknehmen. Positions taken back (qty null) are open anyway: their rows go.
delete from public.order_checks where qty is null;
alter table public.order_checks alter column qty set not null;
