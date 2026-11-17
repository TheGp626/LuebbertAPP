-- Security hardening after the pentest of 17.11.2026.
-- Deploy order: FIRST the Edge Functions pin-login, pin-change, send-reminders, cleanup-folders, notify-folder,
-- notify-plan-change (they work with old and new login emails), THEN this migration.
-- Rollback: supabase/rollback/20261117_security_haertung_rollback.sql. Check: supabase/tests/security_haertung_check.sql.

-- 1) PIN logins: the login email was <user id>@nutzer.luebbert.invalid. User ids are public (login list), so anyone
--    could call Supabase Auth directly with that email and "lbt-pin:" + a guessed 4 digit PIN, past the 5 tries lockout
--    of pin-login. Every account gets a random email; pin-login/pin-change read it from the auth user.
update auth.users u set email = gen_random_uuid()::text || '@nutzer.luebbert.invalid', updated_at = now()
where lower(u.email) = u.id::text || '@nutzer.luebbert.invalid';
update auth.identities i set identity_data = jsonb_set(i.identity_data, '{email}', to_jsonb(u.email)), updated_at = now()
from auth.users u
where i.user_id = u.id and i.provider = 'email' and i.identity_data->>'email' is distinct from u.email;

-- 2) Admin password: was a plain text literal in verify_admin_pin, and every logged-in user (Gast too, which anyone
--    can open) could call verify_admin_pin / set_app_settings as often as they liked to guess it.
--    Now: only a bcrypt hash is stored, in a table nobody but the server can read, and only service_role may check it.
create table public.app_secrets (
  key text primary key,
  hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from public, anon, authenticated;
grant all on public.app_secrets to service_role;

-- The current password is taken from the old function body, so it never appears in this (public) repo
do $$
declare v_old text;
begin
  select substring(pg_get_functiondef('public.verify_admin_pin(text)'::regprocedure) from 'input_pin = ''((?:[^'']|'''')*)''')
    into v_old;
  if v_old is null or v_old = '' then raise exception 'admin password not found in verify_admin_pin'; end if;
  insert into public.app_secrets (key, hash)
  values ('admin_pin', extensions.crypt(replace(v_old, '''''', ''''), extensions.gen_salt('bf', 10)));
end $$;

create or replace function public.verify_admin_pin(input_pin text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_hash text;
begin
  if input_pin is null or input_pin = '' then return false; end if;
  select s.hash into v_hash from public.app_secrets s where s.key = 'admin_pin';
  return v_hash is not null and extensions.crypt(input_pin, v_hash) = v_hash;
end $$;
revoke execute on function public.verify_admin_pin(text) from public, anon, authenticated;
grant execute on function public.verify_admin_pin(text) to service_role;

-- Settings: Admins only (the tab is Admin-only in the app anyway), plus the admin password as before.
-- So guessing the password now needs an Admin's own PIN login first.
create or replace function public.set_app_settings(input_pin text, changes jsonb, actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if (select public.app_role()) is distinct from 'Admin' then
    raise exception 'invalid_pin';
  end if;
  if not coalesce(public.verify_admin_pin(input_pin), false) then
    raise exception 'invalid_pin';
  end if;
  -- the actor is the caller, whatever the client sends
  return public.apply_app_settings(changes, (select auth.uid()));
end $$;
revoke execute on function public.set_app_settings(text, jsonb, uuid) from public, anon;
grant execute on function public.set_app_settings(text, jsonb, uuid) to authenticated, service_role;

-- 3) Small ones from the advisor
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
alter function public.shift_span(date, time, time) set search_path = public;

-- 4) Product photos are a public bucket: an SVG can carry script, so only raster images
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
where id = 'product-images';
