-- ROLLBACK for migration role_rls (2026-11-04). Run manually only, e.g. in the Supabase SQL editor.
-- Restores the policies saved by the migration in public._rls_policy_backup, removes the booking guard,
-- writes hourly_rate_conni / income_limit / email back to app_users and reopens app_user_private as after
-- migration role_rls_prepare. The backup table stays (a later re-run of the migration keeps using it).
begin;

do $$
declare
  affected text[] := array['app_users', 'app_user_private', 'shifts', 'protocols', 'protocol_transports',
    'protocol_equipments', 'worker_ratings', 'projects', 'plan_weeks', 'plan_shifts', 'plan_assignments',
    'plan_name_aliases', 'einsaetze', 'project_folders', 'folder_files', 'products', 'product_images',
    'app_settings', 'folder_deletion_log', 'push_subscriptions'];
  p record;
begin
  if not exists (select 1 from public._rls_policy_backup) then
    raise exception 'rollback aborted: public._rls_policy_backup is empty';
  end if;

  for p in select * from pg_policies
           where ((schemaname = 'public' and tablename = any(affected)) or (schemaname = 'storage' and tablename = 'objects'))
             and policyname like 'rls\_%' loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;

  for p in select * from public._rls_policy_backup order by schemaname, tablename, policyname loop
    if not exists (select 1 from pg_policies x where x.schemaname = p.schemaname
                   and x.tablename = p.tablename and x.policyname = p.policyname) then
      execute format('create policy %I on %I.%I as %s for %s to %s%s%s',
        p.policyname, p.schemaname, p.tablename, lower(p.permissive), p.cmd,
        (select string_agg(quote_ident(r), ', ') from unnest(p.roles) r),
        case when p.qual is not null then format(' using (%s)', p.qual) else '' end,
        case when p.with_check is not null then format(' with check (%s)', p.with_check) else '' end);
    end if;
  end loop;
end $$;

drop trigger if exists shifts_booking_guard on public.shifts;
drop function if exists public.shifts_booking_guard();

alter table public.app_users drop constraint if exists app_users_moved_cols_null;
update public.app_users u
set hourly_rate_conni = p.hourly_rate_conni, income_limit = p.income_limit, email = p.email
from public.app_user_private p
where p.user_id = u.id;

create policy rls_app_user_private_tmp on public.app_user_private
  for all to authenticated using (true) with check (true);

commit;
