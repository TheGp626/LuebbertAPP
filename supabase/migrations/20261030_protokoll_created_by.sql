-- protocols.created_by (applied to production 2026-10-30 as migration protokoll_created_by).
-- The existing anon insert/update policies on public.protocols cover the new column.
alter table public.protocols add column if not exists created_by uuid null references public.app_users(id);
