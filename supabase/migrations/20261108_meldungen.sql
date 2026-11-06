-- Meldungen: "Ich hätte Zeit" (plan_shift_interest) is accepted / rejected like order_applications, and both are
-- decided by Admin + "Sieht Bewerbungen" (sees_plan_interest()) in the Aufträge inbox. Viewers also read the
-- Auftrag data (order_staffing, order_parsed). Rollback: supabase/rollback/20261108_meldungen_rollback.sql.
-- Check: supabase/tests/meldungen_check.sql.

alter table public.plan_shift_interest
  add column status text not null default 'offen' check (status in ('offen', 'angenommen', 'abgelehnt')),
  add column decided_by uuid references public.app_users(id) on delete set null,
  add column decided_at timestamptz;

-- Same bookkeeping as order_applications: starts undecided at now(); who decided and when comes from the server
create trigger plan_shift_interest_decided before insert or update on public.plan_shift_interest
  for each row execute function public.order_applications_decided();

grant update on public.plan_shift_interest to authenticated;

-- The live client lists every row a viewer can read as "Hätten Zeit": a rejected Meldung is visible to its owner and to
-- whoever rejected it (the decide call reads the row back with RETURNING, which needs the new row to be visible)
drop policy rls_plan_shift_interest_select on public.plan_shift_interest;
create policy rls_plan_shift_interest_select on public.plan_shift_interest for select to authenticated
  using (user_id = (select auth.uid())
         or ((select public.sees_plan_interest()) and (status <> 'abgelehnt' or decided_by = (select auth.uid()))));

drop policy rls_plan_shift_interest_insert on public.plan_shift_interest;
create policy rls_plan_shift_interest_insert on public.plan_shift_interest for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.app_role()) <> 'Gast'
              and public.fits_plan_slot(week_id, shift_key) and status = 'offen');
create policy rls_plan_shift_interest_update on public.plan_shift_interest for update to authenticated
  using ((select public.sees_plan_interest()))
  with check ((select public.sees_plan_interest()));
drop policy rls_plan_shift_interest_delete on public.plan_shift_interest;
create policy rls_plan_shift_interest_delete on public.plan_shift_interest for delete to authenticated
  using ((user_id = (select auth.uid()) and status = 'offen') or (select public.sees_plan_interest()));

drop policy rls_order_applications_select on public.order_applications;
create policy rls_order_applications_select on public.order_applications for select to authenticated
  using (user_id = (select auth.uid()) or (select public.sees_plan_interest()));
drop policy rls_order_applications_update on public.order_applications;
create policy rls_order_applications_update on public.order_applications for update to authenticated
  using ((select public.sees_plan_interest()))
  with check ((select public.sees_plan_interest()));
drop policy rls_order_applications_delete on public.order_applications;
create policy rls_order_applications_delete on public.order_applications for delete to authenticated
  using ((user_id = (select auth.uid()) and status = 'offen') or (select public.sees_plan_interest()));

drop policy rls_order_staffing_select on public.order_staffing;
create policy rls_order_staffing_select on public.order_staffing for select to authenticated
  using ((select public.app_role()) in ('Admin', 'PL') or (select public.sees_plan_interest()));
drop policy rls_order_parsed_select on public.order_parsed;
create policy rls_order_parsed_select on public.order_parsed for select to authenticated
  using ((select public.app_role()) in ('Admin', 'PL') or (select public.sees_plan_interest()));
