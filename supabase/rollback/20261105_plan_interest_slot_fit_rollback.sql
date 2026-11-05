drop policy if exists rls_plan_shift_interest_insert on public.plan_shift_interest;
create policy rls_plan_shift_interest_insert on public.plan_shift_interest for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.app_role()) <> 'Gast');
drop function if exists public.fits_plan_slot(uuid, text);
alter table public.app_users drop column if exists can_drive;
