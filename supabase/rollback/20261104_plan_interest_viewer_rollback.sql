drop policy if exists rls_plan_shift_interest_select on public.plan_shift_interest;
create policy rls_plan_shift_interest_select on public.plan_shift_interest for select to authenticated
  using (user_id = (select auth.uid()) or (select public.app_role()) in ('PL', 'Admin'));
drop function if exists public.sees_plan_interest();
alter table public.app_users drop column if exists plan_interest_viewer;
