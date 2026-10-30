-- Calendar subscription: secret token per user for the Edge Function calendar-feed (NOT applied yet).
-- Existing rows get their token from the default. The anon update policy on public.app_users must allow
-- the app to renew the token ("Neuen Link erzeugen"); check it when applying.
alter table public.app_users add column if not exists calendar_token uuid not null default gen_random_uuid();
