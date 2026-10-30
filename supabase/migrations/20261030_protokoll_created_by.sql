-- Who wrote a protocol (for "Meine Protokolle"). Old rows stay null and count as "mine" via al_id / pl_id.
-- The existing anon insert/update policies on public.protocols cover the new column.
alter table public.protocols add column if not exists created_by uuid null references public.app_users(id);
