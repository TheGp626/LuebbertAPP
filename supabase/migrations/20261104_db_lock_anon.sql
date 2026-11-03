-- GDPR part 2, step A: without a login (anon key only) the database returns nothing and accepts nothing.
-- Logged-in users (authenticated, real session from the PIN login) keep exactly today's access.
-- Rollback: supabase/rollback/20261104_db_lock_anon_rollback.sql (manual).
do $$
declare
  p record;
begin
  -- Guard: every anon policy must already have an authenticated twin (from migration pin_login), else stop
  for p in select * from pg_policies where schemaname in ('public', 'storage') and roles = '{anon}' loop
    if not exists (select 1 from pg_policies b
                   where b.schemaname = p.schemaname and b.tablename = p.tablename
                     and b.policyname = left(p.policyname || '_auth', 63) and b.cmd = p.cmd
                     and b.roles = '{authenticated}' and b.permissive = p.permissive) then
      raise exception 'no authenticated twin for %.%: %', p.schemaname, p.tablename, p.policyname;
    end if;
  end loop;

  -- {public} policies also cover anon: recreate them for authenticated only, then drop the originals
  for p in select * from pg_policies where schemaname in ('public', 'storage') and roles = '{public}' loop
    if not exists (select 1 from pg_policies x where x.schemaname = p.schemaname and x.tablename = p.tablename
                   and x.policyname = p.policyname || ' (angemeldet)') then
      execute format('create policy %I on %I.%I as %s for %s to authenticated%s%s',
        p.policyname || ' (angemeldet)', p.schemaname, p.tablename, lower(p.permissive), p.cmd,
        case when p.qual is not null then format(' using (%s)', p.qual) else '' end,
        case when p.with_check is not null then format(' with check (%s)', p.with_check) else '' end);
    end if;
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;

  for p in select * from pg_policies where schemaname in ('public', 'storage') and roles = '{anon}' loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- Functions: only the login name list stays public
revoke execute on function public.verify_admin_pin(text), public.set_app_settings(text, jsonb, uuid), public.rls_auto_enable() from public, anon;
grant execute on function public.verify_admin_pin(text), public.set_app_settings(text, jsonb, uuid), public.rls_auto_enable() to authenticated, service_role;
grant execute on function public.login_names() to anon, authenticated;

-- Second lock: anon has no table/sequence rights at all (an anon policy added by mistake later opens nothing)
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon, public;
