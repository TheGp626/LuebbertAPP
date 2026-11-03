-- Role-based rights, migration 2 (strict): the database enforces who may read and write what, by app_users.role.
-- "Büro" = AL, PL, Buchhaltung, Admin. Needs migration 20261104_role_rls_prepare.sql (app_role, app_user_private).
-- Every policy for authenticated (or public) on the affected tables is saved to public._rls_policy_backup, then
-- dropped and replaced by exactly one set named rls_<table>_<command>.
-- Rollback: supabase/rollback/20261104_role_rls_rollback.sql (manual). Check: supabase/tests/role_rls_check.sql.

-- ══════════════ BACKUP OF THE OLD POLICIES (rollback source) ══════════════

create table if not exists public._rls_policy_backup (
  schemaname name not null,
  tablename  name not null,
  policyname name not null,
  permissive text not null,
  roles      name[] not null,
  cmd        text not null,
  qual       text,
  with_check text,
  saved_at   timestamptz not null default now()
);
alter table public._rls_policy_backup enable row level security;
revoke all on public._rls_policy_backup from public, anon, authenticated;
grant all on public._rls_policy_backup to service_role;

do $$
declare
  affected text[] := array['app_users', 'app_user_private', 'shifts', 'protocols', 'protocol_transports',
    'protocol_equipments', 'worker_ratings', 'projects', 'plan_weeks', 'plan_shifts', 'plan_assignments',
    'plan_name_aliases', 'einsaetze', 'project_folders', 'folder_files', 'products', 'product_images',
    'app_settings', 'folder_deletion_log', 'push_subscriptions'];
  p record;
  t text;
begin
  -- Only the first run saves: a re-run must not overwrite the original policies with our own
  if not exists (select 1 from public._rls_policy_backup) then
    insert into public._rls_policy_backup (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check)
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where ((schemaname = 'public' and tablename = any(affected)) or (schemaname = 'storage' and tablename = 'objects'))
      and ('authenticated' = any(roles) or 'public' = any(roles))
      and policyname not like 'rls\_%';  -- rls_app_user_private_tmp is recreated by the rollback itself
  end if;

  -- {public} policies also apply to authenticated and would OR-widen the new set, so they go too
  for p in select * from pg_policies
           where ((schemaname = 'public' and tablename = any(affected)) or (schemaname = 'storage' and tablename = 'objects'))
             and ('authenticated' = any(roles) or 'public' = any(roles)) loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;

  foreach t in array affected loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ══════════════ BOOKING GUARD ══════════════
-- Only Buchhaltung/Admin may set a shift to 'eingetragen'. A trigger, not the UPDATE policy, so office roles can still
-- edit booked rows (protocol saves change role/date of booked shifts and keep the status).
-- Edge Functions (service_role) and SQL sessions without a JWT user are not checked.
create or replace function public.shifts_booking_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if auth.uid() is null or claims ->> 'role' = 'service_role' then
    return new;
  end if;
  if new.status = 'eingetragen'
     and (tg_op = 'INSERT' or old.status is distinct from 'eingetragen')
     and public.app_role() not in ('Buchhaltung', 'Admin') then
    raise exception 'only Buchhaltung or Admin may book a shift' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke execute on function public.shifts_booking_guard() from public, anon, authenticated;

drop trigger if exists shifts_booking_guard on public.shifts;
create trigger shifts_booking_guard before insert or update on public.shifts
  for each row execute function public.shifts_booking_guard();

-- ══════════════ NEW POLICIES ══════════════
-- (select ...) around app_role()/auth.uid(): evaluated once per statement, not per row.

-- app_users: name list for everyone goes through user_directory()/login_names()
create policy rls_app_users_select on public.app_users for select to authenticated
  using (id = (select auth.uid()) or (select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin'));
create policy rls_app_users_insert on public.app_users for insert to authenticated
  with check ((select public.app_role()) in ('Buchhaltung', 'Admin'));
create policy rls_app_users_update on public.app_users for update to authenticated
  using ((select public.app_role()) in ('Buchhaltung', 'Admin'))
  with check ((select public.app_role()) in ('Buchhaltung', 'Admin'));
create policy rls_app_users_delete on public.app_users for delete to authenticated
  using ((select public.app_role()) = 'Admin');

create policy rls_app_user_private_select on public.app_user_private for select to authenticated
  using (user_id = (select auth.uid()) or (select public.app_role()) in ('Buchhaltung', 'Admin'));
create policy rls_app_user_private_insert on public.app_user_private for insert to authenticated
  with check ((select public.app_role()) in ('Buchhaltung', 'Admin'));
create policy rls_app_user_private_update on public.app_user_private for update to authenticated
  using ((select public.app_role()) in ('Buchhaltung', 'Admin'))
  with check ((select public.app_role()) in ('Buchhaltung', 'Admin'));
create policy rls_app_user_private_delete on public.app_user_private for delete to authenticated
  using ((select public.app_role()) in ('Buchhaltung', 'Admin'));

create policy rls_shifts_select on public.shifts for select to authenticated
  using (user_id = (select auth.uid()) or (select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin'));
create policy rls_shifts_insert on public.shifts for insert to authenticated
  with check ((user_id = (select auth.uid()) and protocol_id is null and status = 'offen')
              or (select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin'));
create policy rls_shifts_update on public.shifts for update to authenticated
  using ((select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin'))
  with check ((select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin'));
create policy rls_shifts_delete on public.shifts for delete to authenticated
  using ((user_id = (select auth.uid()) and protocol_id is null and status = 'offen')
         or ((select public.app_role()) in ('AL', 'PL') and status = 'offen')
         or (select public.app_role()) in ('Buchhaltung', 'Admin'));

-- MA: only protocols with an own shift (the subquery runs under the shifts policies: own shifts only)
create policy rls_protocols_select on public.protocols for select to authenticated
  using ((select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin')
         or exists (select 1 from public.shifts s where s.protocol_id = protocols.id and s.user_id = (select auth.uid())));
create policy rls_protocols_insert on public.protocols for insert to authenticated
  with check ((select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin'));
create policy rls_protocols_update on public.protocols for update to authenticated
  using ((select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin'))
  with check ((select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin'));
create policy rls_protocols_delete on public.protocols for delete to authenticated
  using ((select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin'));

-- Uniform tables: one read rule, one write rule (insert/update/delete); null write rule = no write policies
do $$
declare
  r record;
  buero constant text := '(select public.app_role()) in (''AL'', ''PL'', ''Buchhaltung'', ''Admin'')';
  not_gast constant text := '(select public.app_role()) <> ''Gast''';
  pl_admin constant text := '(select public.app_role()) in (''PL'', ''Admin'')';
  al_pl_admin constant text := '(select public.app_role()) in (''AL'', ''PL'', ''Admin'')';
begin
  for r in select * from (values
      ('protocol_transports', buero, buero),
      ('protocol_equipments', buero, buero),
      ('worker_ratings', buero, buero),
      ('projects', not_gast, buero),
      ('plan_weeks', not_gast, pl_admin),
      ('plan_shifts', not_gast, pl_admin),
      ('plan_assignments', not_gast, pl_admin),
      ('plan_name_aliases', not_gast, pl_admin),
      ('einsaetze', 'true', pl_admin),
      ('project_folders', 'true', pl_admin),
      ('folder_files', 'true', pl_admin),
      ('products', 'true', al_pl_admin),
      ('product_images', 'true', al_pl_admin),
      ('app_settings', 'true', null),
      ('folder_deletion_log', 'true', null)
    ) v(t, rd, wr) loop
    execute format('create policy %I on public.%I for select to authenticated using (%s)', 'rls_' || r.t || '_select', r.t, r.rd);
    if r.wr is not null then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', 'rls_' || r.t || '_insert', r.t, r.wr);
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', 'rls_' || r.t || '_update', r.t, r.wr, r.wr);
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', 'rls_' || r.t || '_delete', r.t, r.wr);
    end if;
  end loop;
end $$;

-- A device may change owner (UPDATE using true); the endpoint is not guessable
create policy rls_push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy rls_push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy rls_push_subscriptions_update on public.push_subscriptions for update to authenticated
  using (true) with check (user_id = (select auth.uid()));
create policy rls_push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- Storage: read all four buckets; project-files written by PL/Admin, product-* by AL/PL/Admin
create policy rls_objects_select on storage.objects for select to authenticated
  using (bucket_id in ('project-files', 'product-images', 'product-pdfs', 'product-videos'));
create policy rls_objects_insert on storage.objects for insert to authenticated
  with check ((bucket_id = 'project-files' and (select public.app_role()) in ('PL', 'Admin'))
              or (bucket_id in ('product-images', 'product-pdfs', 'product-videos')
                  and (select public.app_role()) in ('AL', 'PL', 'Admin')));
create policy rls_objects_update on storage.objects for update to authenticated
  using ((bucket_id = 'project-files' and (select public.app_role()) in ('PL', 'Admin'))
         or (bucket_id in ('product-images', 'product-pdfs', 'product-videos')
             and (select public.app_role()) in ('AL', 'PL', 'Admin')))
  with check ((bucket_id = 'project-files' and (select public.app_role()) in ('PL', 'Admin'))
              or (bucket_id in ('product-images', 'product-pdfs', 'product-videos')
                  and (select public.app_role()) in ('AL', 'PL', 'Admin')));
create policy rls_objects_delete on storage.objects for delete to authenticated
  using ((bucket_id = 'project-files' and (select public.app_role()) in ('PL', 'Admin'))
         or (bucket_id in ('product-images', 'product-pdfs', 'product-videos')
             and (select public.app_role()) in ('AL', 'PL', 'Admin')));

-- ══════════════ SENSITIVE COLUMNS ══════════════
-- Users created by an old app version after migration 1 have no private row yet: copy before clearing.
insert into public.app_user_private (user_id, hourly_rate_conni, income_limit, email)
select id, hourly_rate_conni, income_limit, email from public.app_users
on conflict (user_id) do nothing;
-- Columns stay (rollback writes them back from app_user_private)
update public.app_users set hourly_rate_conni = null, income_limit = null, email = null
where hourly_rate_conni is not null or income_limit is not null or email is not null;
-- An old cached app version writing these columns gets an error instead of silently losing the values
alter table public.app_users drop constraint if exists app_users_moved_cols_null;
alter table public.app_users add constraint app_users_moved_cols_null
  check (hourly_rate_conni is null and income_limit is null and email is null);
