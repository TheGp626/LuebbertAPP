-- PL no longer sees "Ich hätte Zeit" applicants by default: only Admin, or anyone with app_users.plan_interest_viewer.
-- Rollback: supabase/rollback/20261104_plan_interest_pl_off_rollback.sql.
create or replace function public.sees_plan_interest() returns boolean
language sql stable security definer set search_path = public as $$
  select (select public.app_role()) = 'Admin'
    or exists (select 1 from public.app_users where id = (select auth.uid()) and is_active is not false and plan_interest_viewer);
$$;
