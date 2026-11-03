-- Assertions for migration db_lock_anon. Run only inside a transaction that is rolled back
-- (after the migration body); raises on the first failed check. Never apply as a migration.
do $$
declare
  n int;
  t record;
begin
  select count(*) into n from pg_policies
   where schemaname in ('public', 'storage') and ('anon' = any(roles) or roles = '{public}');
  if n <> 0 then raise exception 'check failed: % anon/public policies left', n; end if;

  select count(*) into n from pg_policies
   where schemaname in ('public', 'storage') and policyname like '% (angemeldet)' and roles = '{authenticated}';
  if n <> 6 then raise exception 'check failed: % (angemeldet) policies instead of 6', n; end if;

  for t in select c.oid, c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind in ('r', 'v') loop
    if has_table_privilege('anon', t.oid, 'select') or has_table_privilege('anon', t.oid, 'insert')
       or has_table_privilege('anon', t.oid, 'update') or has_table_privilege('anon', t.oid, 'delete')
       or has_table_privilege('anon', t.oid, 'truncate') then
      raise exception 'check failed: anon still has rights on %', t.relname;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.verify_admin_pin(text)', 'execute')
     or has_function_privilege('anon', 'public.set_app_settings(text, jsonb, uuid)', 'execute')
     or has_function_privilege('anon', 'public.rls_auto_enable()', 'execute') then
    raise exception 'check failed: anon can still execute a closed function';
  end if;
  if not has_function_privilege('anon', 'public.login_names()', 'execute') then
    raise exception 'check failed: login_names no longer public';
  end if;
  if not has_function_privilege('authenticated', 'public.set_app_settings(text, jsonb, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.verify_admin_pin(text)', 'execute')
     or not has_function_privilege('service_role', 'public.verify_admin_pin(text)', 'execute') then
    raise exception 'check failed: authenticated/service_role lost a function right';
  end if;

  set local role anon;
  select count(*) into n from public.login_names();
  reset role;
  if n = 0 then raise exception 'check failed: login_names empty for anon'; end if;

  perform set_config('request.jwt.claims', '{"sub":"cb3768a5-6b38-4855-b940-45d52228cac5","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from public.shifts;
  if n = 0 then raise exception 'check failed: authenticated sees no shifts'; end if;
  select count(*) into n from public.products;
  if n = 0 then raise exception 'check failed: authenticated sees no products'; end if;
  select count(*) into n from storage.objects;
  if n = 0 then raise exception 'check failed: authenticated sees no storage objects'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
    values ('zz-db-lock-check', 'cb3768a5-6b38-4855-b940-45d52228cac5', 'x', 'x');
  reset role;
end $$;
select 'all checks passed' as result;
