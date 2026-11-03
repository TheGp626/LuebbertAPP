-- PL may edit workers (rates, email, income limit, role) like Buchhaltung/Admin, with three limits enforced by the
-- trigger app_users_pl_guard: a PL never assigns Buchhaltung/Admin, never edits a Buchhaltung/Admin account and never
-- changes their own role. Needs migration 20261104_role_rls.sql. Adding/deleting users stays Buchhaltung/Admin.
-- Rollback: supabase/rollback/20261104_pl_edit_workers_rollback.sql. Check: supabase/tests/pl_edit_workers_check.sql.

drop policy if exists rls_app_users_update on public.app_users;
create policy rls_app_users_update on public.app_users for update to authenticated
  using ((select public.app_role()) in ('PL', 'Buchhaltung', 'Admin'))
  with check ((select public.app_role()) in ('PL', 'Buchhaltung', 'Admin'));

-- PL reads every private row (worker list), writes only rows of non-Buchhaltung/Admin users
drop policy if exists rls_app_user_private_select on public.app_user_private;
create policy rls_app_user_private_select on public.app_user_private for select to authenticated
  using (user_id = (select auth.uid()) or (select public.app_role()) in ('PL', 'Buchhaltung', 'Admin'));
drop policy if exists rls_app_user_private_insert on public.app_user_private;
create policy rls_app_user_private_insert on public.app_user_private for insert to authenticated
  with check ((select public.app_role()) in ('Buchhaltung', 'Admin')
              or ((select public.app_role()) = 'PL'
                  and not exists (select 1 from public.app_users u where u.id = user_id and u.role in ('Buchhaltung', 'Admin'))));
drop policy if exists rls_app_user_private_update on public.app_user_private;
create policy rls_app_user_private_update on public.app_user_private for update to authenticated
  using ((select public.app_role()) in ('Buchhaltung', 'Admin')
         or ((select public.app_role()) = 'PL'
             and not exists (select 1 from public.app_users u where u.id = user_id and u.role in ('Buchhaltung', 'Admin'))))
  with check ((select public.app_role()) in ('Buchhaltung', 'Admin')
              or ((select public.app_role()) = 'PL'
                  and not exists (select 1 from public.app_users u where u.id = user_id and u.role in ('Buchhaltung', 'Admin'))));

-- German messages: the app shows err.message as is ("Fehler beim Speichern: …")
create or replace function public.app_users_pl_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if auth.uid() is null or claims ->> 'role' = 'service_role' or public.app_role() <> 'PL' then
    return new;
  end if;
  if old.role in ('Buchhaltung', 'Admin') then
    raise exception 'PLs können Buchhaltung/Admin nicht bearbeiten' using errcode = 'insufficient_privilege';
  end if;
  if new.role is distinct from old.role then
    if new.role in ('Buchhaltung', 'Admin') then
      raise exception 'PLs können die Rolle Buchhaltung/Admin nicht vergeben' using errcode = 'insufficient_privilege';
    end if;
    if new.id = auth.uid() then
      raise exception 'Die eigene Rolle kann nur Buchhaltung/Admin ändern' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.app_users_pl_guard() from public, anon, authenticated;

drop trigger if exists app_users_pl_guard on public.app_users;
create trigger app_users_pl_guard before update on public.app_users
  for each row execute function public.app_users_pl_guard();
