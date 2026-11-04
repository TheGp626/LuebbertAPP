-- PL may add workers too (never as Buchhaltung/Admin). The trigger app_users_pl_guard now also runs on INSERT and
-- gives the German message; deleting users stays Admin. Needs migration 20261104_pl_edit_workers.sql.
-- Rollback: supabase/rollback/20261104_pl_add_workers_rollback.sql. Check: supabase/tests/pl_add_workers_check.sql.

drop policy if exists rls_app_users_insert on public.app_users;
create policy rls_app_users_insert on public.app_users for insert to authenticated
  with check ((select public.app_role()) in ('PL', 'Buchhaltung', 'Admin'));

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
  if tg_op = 'INSERT' then
    if new.role in ('Buchhaltung', 'Admin') then
      raise exception 'PLs können die Rolle Buchhaltung/Admin nicht vergeben' using errcode = 'insufficient_privilege';
    end if;
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
create trigger app_users_pl_guard before insert or update on public.app_users
  for each row execute function public.app_users_pl_guard();
