-- Assertions for migration security_haertung. Run only inside a transaction that is rolled back (after the migration body).
do $$
declare v_ma uuid; v_admin uuid; ok boolean; n int;
begin
  -- no login email can be rebuilt from a user id any more
  select count(*) into n from auth.users u where lower(u.email) = u.id::text || '@nutzer.luebbert.invalid';
  if n <> 0 then raise exception '% accounts still have the derived email', n; end if;
  select count(*) into n from auth.identities i join auth.users u on u.id = i.user_id
   where i.provider = 'email' and i.identity_data->>'email' is distinct from u.email;
  if n <> 0 then raise exception '% identities out of sync', n; end if;
  select count(*) into n from auth.users u where u.email not like '%@nutzer.luebbert.invalid';
  if n <> 0 then raise exception '% accounts lost their domain', n; end if;

  -- the password check still works for the server, is hashed, and nobody else can call it
  if not exists (select 1 from public.app_secrets where key = 'admin_pin' and hash like '$2%') then raise exception 'no bcrypt hash'; end if;
  if public.verify_admin_pin('') or public.verify_admin_pin(null) or public.verify_admin_pin('falsch') then raise exception 'wrong password accepted'; end if;
  if has_function_privilege('authenticated', 'public.verify_admin_pin(text)', 'execute') then raise exception 'authenticated may call verify_admin_pin'; end if;
  if has_function_privilege('anon', 'public.verify_admin_pin(text)', 'execute') then raise exception 'anon may call verify_admin_pin'; end if;
  if not has_function_privilege('service_role', 'public.verify_admin_pin(text)', 'execute') then raise exception 'service_role lost verify_admin_pin'; end if;
  if has_table_privilege('authenticated', 'public.app_secrets', 'select') then raise exception 'authenticated reads app_secrets'; end if;
  if pg_get_functiondef('public.verify_admin_pin(text)'::regprocedure) ~* 'return\s+input_pin\s*=' then raise exception 'plain text password still in function'; end if;

  -- a non-Admin can't save settings, even with the right password (tested with a wrong one: role check comes first)
  select u.id into v_ma from public.app_users u where u.role = 'MA' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.set_app_settings('x', '{}'::jsonb, v_ma); exception when others then ok := sqlerrm = 'invalid_pin'; end;
  if not ok then raise exception 'MA reached set_app_settings'; end if;
  ok := false;
  begin perform public.verify_admin_pin('x'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA could call verify_admin_pin'; end if;
  reset role;

  -- an Admin with a wrong password is refused
  select u.id into v_admin from public.app_users u where u.role = 'Admin' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.set_app_settings('falsch', '{}'::jsonb, v_admin); exception when others then ok := sqlerrm = 'invalid_pin'; end;
  if not ok then raise exception 'Admin with wrong password got through'; end if;
  reset role;

  if exists (select 1 from storage.buckets where id = 'product-images' and 'image/svg+xml' = any(allowed_mime_types)) then raise exception 'svg still allowed'; end if;
  raise notice 'security_haertung_check: ok';
end $$;
