-- Rollback of 20261205_planen_flow. Deploy the previous app first (it falls back to order_slots() anyway).
drop function if exists public.planner_order_phases();
alter table public.plan_draft_shifts drop column if exists manual, drop column if exists auftrag_changes, drop column if exists pair_id;
drop policy if exists rls_order_staffing_insert on public.order_staffing;
create policy rls_order_staffing_insert on public.order_staffing for insert to authenticated
  with check ((select public.app_role()) in ('Admin', 'PL'));
drop policy if exists rls_order_staffing_update on public.order_staffing;
create policy rls_order_staffing_update on public.order_staffing for update to authenticated
  using ((select public.app_role()) in ('Admin', 'PL')) with check ((select public.app_role()) in ('Admin', 'PL'));
