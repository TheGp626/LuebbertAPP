-- Meldungen: "Ich hätte Zeit" (plan_shift_interest) is accepted / rejected like order_applications, and both are
-- decided by Admin + "Sieht Bewerbungen" (sees_plan_interest()) in the Aufträge inbox. Viewers also read the
-- Auftrag data (order_staffing, order_parsed). Rollback: supabase/rollback/20261108_meldungen_rollback.sql.
-- Check: supabase/tests/meldungen_check.sql.

alter table public.plan_shift_interest
  add column status text not null default 'offen' check (status in ('offen', 'angenommen', 'abgelehnt')),
  add column decided_by uuid references public.app_users(id) on delete set null,
  add column decided_at timestamptz;

-- Deciders may add an accepted Meldung for someone else („Hätten laut Verfügbarkeit Zeit“ → Annehmen):
-- an insert that is not 'offen' records who accepted it; an 'offen' insert starts undecided as before
create or replace function public.order_applications_decided() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    if new.status = 'offen' then
      new.decided_by := null;
      new.decided_at := null;
    else
      new.decided_by := auth.uid();
      new.decided_at := now();
    end if;
  elsif new.status is distinct from old.status then
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  return new;
end $$;

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
              and public.fits_plan_slot(week_id, shift_key) and status = 'offen'
              or ((select public.sees_plan_interest()) and status = 'angenommen'));
create policy rls_plan_shift_interest_update on public.plan_shift_interest for update to authenticated
  using ((select public.sees_plan_interest()))
  with check ((select public.sees_plan_interest()));
drop policy rls_plan_shift_interest_delete on public.plan_shift_interest;
create policy rls_plan_shift_interest_delete on public.plan_shift_interest for delete to authenticated
  using ((user_id = (select auth.uid()) and status = 'offen') or (select public.sees_plan_interest()));

drop policy rls_order_applications_insert on public.order_applications;
create policy rls_order_applications_insert on public.order_applications for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.app_role()) <> 'Gast' and status = 'offen'
              or ((select public.sees_plan_interest()) and status = 'angenommen'));
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
