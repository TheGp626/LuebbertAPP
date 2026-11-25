-- One switch "Planung" instead of two (25.11.2026): "Plant den Wochenplan" (app_users.plans_week) and
-- "Sieht Bewerbungen" (app_users.plan_interest_viewer) are now always the same. Both columns stay, so every policy and
-- function that reads one of them keeps working; a trigger keeps them equal. Whoever had either switch gets both.
-- Changing it is Admin only (until now a PL could set "Sieht Bewerbungen", which would now include planning).
-- Rollback: supabase/rollback/20261204_planung_ein_schalter_rollback.sql. Check: supabase/tests/planung_ein_schalter_check.sql.

-- Guard + sync in the existing trigger function (trigger app_users_plans_week_guard, before update)
create or replace function public.app_users_plans_week_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  -- one switch: whichever column was changed sets the other
  if new.plan_interest_viewer is distinct from old.plan_interest_viewer then new.plans_week := new.plan_interest_viewer;
  elsif new.plans_week is distinct from old.plans_week then new.plan_interest_viewer := new.plans_week;
  end if;
  if new.plans_week is not distinct from old.plans_week then return new; end if;
  if auth.uid() is null or claims ->> 'role' = 'service_role' or public.app_role() = 'Admin' then return new; end if;
  raise exception '„Planung“ kann nur ein Admin ändern' using errcode = 'insufficient_privilege';
end $$;

-- New people: both columns equal from the start
create or replace function public.app_users_planung_insert() returns trigger
language plpgsql set search_path = public as $$
begin
  new.plans_week := coalesce(new.plans_week, false) or coalesce(new.plan_interest_viewer, false);
  new.plan_interest_viewer := new.plans_week;
  return new;
end $$;
revoke execute on function public.app_users_planung_insert() from public, anon, authenticated;
drop trigger if exists app_users_planung_insert on public.app_users;
create trigger app_users_planung_insert before insert on public.app_users
  for each row execute function public.app_users_planung_insert();

-- Whoever had either switch gets both (runs without auth.uid(): the guard lets it through)
update public.app_users set plans_week = true, plan_interest_viewer = true
  where (plans_week or plan_interest_viewer) and not (plans_week and plan_interest_viewer);
