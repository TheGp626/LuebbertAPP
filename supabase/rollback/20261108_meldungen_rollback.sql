-- Rollback of 20261108_meldungen.sql: policies as they were before (read from production on 2026-11-06),
-- then trigger, update grant and the status columns (decisions on "Ich hätte Zeit" are lost).

drop policy rls_order_parsed_select on public.order_parsed;
create policy rls_order_parsed_select on public.order_parsed for select to authenticated
  using ((select public.app_role()) in ('Admin', 'PL'));
drop policy rls_order_staffing_select on public.order_staffing;
create policy rls_order_staffing_select on public.order_staffing for select to authenticated
  using ((select public.app_role()) in ('Admin', 'PL'));

drop policy rls_order_applications_delete on public.order_applications;
create policy rls_order_applications_delete on public.order_applications for delete to authenticated
  using ((user_id = (select auth.uid()) and status = 'offen') or (select public.app_role()) in ('Admin', 'PL'));
drop policy rls_order_applications_update on public.order_applications;
create policy rls_order_applications_update on public.order_applications for update to authenticated
  using ((select public.app_role()) in ('Admin', 'PL'))
  with check ((select public.app_role()) in ('Admin', 'PL'));
drop policy rls_order_applications_select on public.order_applications;
create policy rls_order_applications_select on public.order_applications for select to authenticated
  using (user_id = (select auth.uid()) or (select public.app_role()) in ('Admin', 'PL'));

drop policy rls_plan_shift_interest_delete on public.plan_shift_interest;
create policy rls_plan_shift_interest_delete on public.plan_shift_interest for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.app_role()) in ('PL', 'Admin'));
drop policy rls_plan_shift_interest_update on public.plan_shift_interest;
drop policy rls_plan_shift_interest_insert on public.plan_shift_interest;
create policy rls_plan_shift_interest_insert on public.plan_shift_interest for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.app_role()) <> 'Gast'
              and public.fits_plan_slot(week_id, shift_key));

revoke update on public.plan_shift_interest from authenticated;
drop trigger plan_shift_interest_decided on public.plan_shift_interest;
alter table public.plan_shift_interest drop column decided_at, drop column decided_by, drop column status;
