-- Show the worker's name as "Display name" in Supabase Auth > Users (an auth account exists only once a PIN is set).
-- 1) new PIN accounts get the name on creation, 2) renames in app_users follow, 3) backfill existing accounts.

create or replace function public.auth_user_set_display_name()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select full_name into v_name from public.app_users where id = new.id;
  if v_name is not null then
    new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('display_name', v_name);
  end if;
  return new;
end $$;
revoke all on function public.auth_user_set_display_name() from public, anon, authenticated;

drop trigger if exists auth_user_set_display_name on auth.users;
create trigger auth_user_set_display_name before insert on auth.users
  for each row execute function public.auth_user_set_display_name();

create or replace function public.app_users_sync_display_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('display_name', new.full_name)
   where id = new.id;
  return null;
end $$;
revoke all on function public.app_users_sync_display_name() from public, anon, authenticated;

drop trigger if exists app_users_sync_display_name on public.app_users;
create trigger app_users_sync_display_name after update of full_name on public.app_users
  for each row when (new.full_name is distinct from old.full_name)
  execute function public.app_users_sync_display_name();

update auth.users a
   set raw_user_meta_data = coalesce(a.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('display_name', u.full_name)
  from public.app_users u
 where u.id = a.id;
