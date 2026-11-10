-- Undo migration besetzungsplaner. Manual; drops every draft (published weeks in plan_weeks/plan_shifts stay as they are).
drop policy if exists rls_order_plan_links_update_planner on public.order_plan_links;
drop policy if exists rls_order_plan_links_insert_planner on public.order_plan_links;
drop policy if exists rls_plan_assignments_delete_planner on public.plan_assignments;
drop policy if exists rls_plan_assignments_update_planner on public.plan_assignments;
drop policy if exists rls_plan_assignments_insert_planner on public.plan_assignments;
drop policy if exists rls_plan_shifts_delete_planner on public.plan_shifts;
drop policy if exists rls_plan_shifts_update_planner on public.plan_shifts;
drop policy if exists rls_plan_shifts_insert_planner on public.plan_shifts;
drop policy if exists rls_plan_weeks_delete_planner on public.plan_weeks;
drop policy if exists rls_plan_weeks_update_planner on public.plan_weeks;
drop policy if exists rls_plan_weeks_insert_planner on public.plan_weeks;
drop table if exists public.plan_draft_shifts;
drop function if exists public.plan_draft_shifts_touch();
drop table if exists public.plan_draft_weeks;
drop trigger if exists app_users_plans_week_guard on public.app_users;
drop function if exists public.app_users_plans_week_guard();
drop function if exists public.plans_week();
alter table public.app_users drop column if exists plans_week;
