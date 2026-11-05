-- Spedition costs vary per day/load: entered per transport in the protocol (null = no amount, old rows)
-- Rollback: alter table public.protocol_transports drop column cost;
alter table public.protocol_transports add column if not exists cost numeric check (cost is null or cost >= 0);
