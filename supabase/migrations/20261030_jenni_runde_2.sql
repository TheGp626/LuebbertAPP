-- Jenni round 2. NOT applied by the app; run once by hand in the Supabase SQL editor.
-- All statements are additive and idempotent (safe to run twice, old rows are untouched).

-- Driver hours of a transport (null = row saved before this existed -> no driver cost)
alter table public.protocol_transports add column if not exists driver_hours numeric null;
-- Registered driver (rate lookup); null = free-text name
alter table public.protocol_transports add column if not exists driver_user_id uuid null references public.app_users(id);
