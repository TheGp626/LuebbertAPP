-- Edge Functions (service_role) read/write the private PIN tables; anon/authenticated stay locked out
grant select, insert, update, delete on public.pin_lockouts to service_role;
grant select, insert on public.pin_reset_log to service_role;
grant usage, select on sequence public.pin_reset_log_id_seq to service_role;
