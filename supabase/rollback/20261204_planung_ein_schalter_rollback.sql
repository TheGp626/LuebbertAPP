-- Rollback of 20261204_planung_ein_schalter: two separate switches again (the values stay as merged).
drop trigger if exists app_users_planung_insert on public.app_users;
drop function if exists public.app_users_planung_insert();
create or replace function public.app_users_plans_week_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if new.plans_week is not distinct from old.plans_week then return new; end if;
  if auth.uid() is null or claims ->> 'role' = 'service_role' or public.app_role() = 'Admin' then return new; end if;
  raise exception '„Plant den Wochenplan“ kann nur ein Admin ändern' using errcode = 'insufficient_privilege';
end $$;
