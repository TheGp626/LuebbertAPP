-- ROLLBACK for migration pl_add_workers (2026-11-04). Run manually only. Adding users goes back to
-- Buchhaltung/Admin; the guard keeps running on UPDATE only (state after pl_edit_workers).
begin;

drop policy if exists rls_app_users_insert on public.app_users;
create policy rls_app_users_insert on public.app_users for insert to authenticated
  with check ((select public.app_role()) in ('Buchhaltung', 'Admin'));

drop trigger if exists app_users_pl_guard on public.app_users;
create trigger app_users_pl_guard before update on public.app_users
  for each row execute function public.app_users_pl_guard();

commit;
