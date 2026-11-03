-- ROLLBACK for migration pl_edit_workers (2026-11-04). Run manually only. Restores the role_rls state:
-- worker edits and pay/email only for Buchhaltung/Admin.
begin;

drop trigger if exists app_users_pl_guard on public.app_users;
drop function if exists public.app_users_pl_guard();

drop policy if exists rls_app_users_update on public.app_users;
create policy rls_app_users_update on public.app_users for update to authenticated
  using ((select public.app_role()) in ('Buchhaltung', 'Admin'))
  with check ((select public.app_role()) in ('Buchhaltung', 'Admin'));

drop policy if exists rls_app_user_private_select on public.app_user_private;
create policy rls_app_user_private_select on public.app_user_private for select to authenticated
  using (user_id = (select auth.uid()) or (select public.app_role()) in ('Buchhaltung', 'Admin'));
drop policy if exists rls_app_user_private_insert on public.app_user_private;
create policy rls_app_user_private_insert on public.app_user_private for insert to authenticated
  with check ((select public.app_role()) in ('Buchhaltung', 'Admin'));
drop policy if exists rls_app_user_private_update on public.app_user_private;
create policy rls_app_user_private_update on public.app_user_private for update to authenticated
  using ((select public.app_role()) in ('Buchhaltung', 'Admin'))
  with check ((select public.app_role()) in ('Buchhaltung', 'Admin'));

commit;
