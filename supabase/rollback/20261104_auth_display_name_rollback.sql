-- ROLLBACK for migration auth_display_name (2026-11-04). Run manually only.
-- Removes both triggers; display_name stays in auth metadata (harmless) unless the last statement is run too.
begin;

drop trigger if exists auth_user_set_display_name on auth.users;
drop trigger if exists app_users_sync_display_name on public.app_users;
drop function if exists public.auth_user_set_display_name();
drop function if exists public.app_users_sync_display_name();
-- optional: update auth.users set raw_user_meta_data = raw_user_meta_data - 'display_name';

commit;
