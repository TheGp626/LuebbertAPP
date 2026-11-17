-- Rollback of 20261117_security_haertung. Deploy the old Edge Functions FIRST if you also roll those back:
-- the old pin-login/pin-change rebuild the login email from the user id, which step 1 here restores.
-- The admin password stays hashed in app_secrets (the plain text literal is never written back).
begin;
update auth.users u set email = u.id::text || '@nutzer.luebbert.invalid', updated_at = now()
where u.email like '%@nutzer.luebbert.invalid' and lower(u.email) <> u.id::text || '@nutzer.luebbert.invalid';
update auth.identities i set identity_data = jsonb_set(i.identity_data, '{email}', to_jsonb(u.email)), updated_at = now()
from auth.users u where i.user_id = u.id and i.provider = 'email' and i.identity_data->>'email' is distinct from u.email;

grant execute on function public.verify_admin_pin(text) to authenticated;
create or replace function public.set_app_settings(input_pin text, changes jsonb, actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.verify_admin_pin(input_pin), false) then
    raise exception 'invalid_pin';
  end if;
  return public.apply_app_settings(changes, actor);
end $$;
grant execute on function public.rls_auto_enable() to authenticated;
alter function public.shift_span(date, time, time) reset search_path;
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
where id = 'product-images';
commit;
