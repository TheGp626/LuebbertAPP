-- Per-user switch: who may see the "Ich hätte Zeit" applicants besides PL/Admin (e.g. Daniel, Kacper as AL, a stand-in).
-- app_users UPDATE is PL/Buchhaltung/Admin only, so nobody can grant the flag to themselves.
-- Rollback: supabase/rollback/20261104_plan_interest_viewer_rollback.sql. Check: supabase/tests/plan_shift_interest_check.sql.
alter table public.app_users add column plan_interest_viewer boolean not null default false;

create function public.sees_plan_interest() returns boolean
language sql stable security definer set search_path = public as $$
  select (select public.app_role()) in ('PL', 'Admin')
    or exists (select 1 from public.app_users where id = (select auth.uid()) and is_active is not false and plan_interest_viewer);
$$;
revoke all on function public.sees_plan_interest() from public, anon;
grant execute on function public.sees_plan_interest() to authenticated;

drop policy rls_plan_shift_interest_select on public.plan_shift_interest;
create policy rls_plan_shift_interest_select on public.plan_shift_interest for select to authenticated
  using (user_id = (select auth.uid()) or (select public.sees_plan_interest()));
