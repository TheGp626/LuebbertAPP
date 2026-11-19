-- Rollback of 20261120_mitarbeiter_pflegen. Assigned shifts keep their user_id (undo them first with unassign_worker_name
-- if needed).
drop function if exists public.income_shares(uuid[], date, date, date, integer);
drop function if exists public.team_photos();
drop function if exists public.clear_photo(uuid);
drop function if exists public.set_my_photo(boolean);
drop policy if exists rls_avatars_select on storage.objects;
drop policy if exists rls_avatars_insert on storage.objects;
drop policy if exists rls_avatars_update on storage.objects;
drop policy if exists rls_avatars_delete on storage.objects;
-- SQL may not delete storage rows: empty and delete the bucket avatars in the Supabase dashboard (Storage) afterwards.
drop function if exists public.minors_among(uuid[]);
drop function if exists public.i_am_minor();
drop table if exists public.staff_minors;
drop function if exists public.unassign_worker_name(text, uuid);
drop function if exists public.assign_worker_name(text, uuid);
drop table if exists public.worker_name_aliases;
alter table public.app_users drop column if exists keep_until, drop column if exists photo_path, drop column if exists photo_consent_at;
delete from public.app_settings where key in ('income_limit_minijob', 'income_limit_midijob', 'inactive_months');
do $$
declare def text := pg_get_functiondef('public.apply_app_settings(jsonb,uuid)'::regprocedure);
declare nd text;
begin
  nd := regexp_replace(def, 'elsif k in \(''income_limit_minijob''.*?(elsif k = ''department_routes'' then)', '\1', 's');
  if nd = def then raise exception 'apply_app_settings: block not found'; end if;
  execute nd;
end $$;
