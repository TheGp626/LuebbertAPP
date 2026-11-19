-- Unter 18 and Lange kein Einsatz (Jenni, 19.11.2026)
-- 1. staff_minors.birth_date (optional, only Admin/Buchhaltung read it). From the 18th birthday on the person no longer
--    counts as under 18 (i_am_minor, minors_among); a nightly job deletes the row (cron 'end-minors-daily').
-- 2. minors_among also for AL/PL/Buchhaltung/Admin: the protocol computes the breaks of people under 18 (JArbSchG)
--    and warns before 6 / after 20 Uhr or over 8 h. Only ids of the people asked about, never birthdays.
-- 3. „Lange kein Einsatz“ after 2 months instead of 3 (only if still the old default).
-- Rollback: supabase/rollback/20261123_unter_18_rollback.sql. Check: supabase/tests/unter_18_check.sql.

alter table public.staff_minors add column if not exists birth_date date;

grant update on public.staff_minors to authenticated;
drop policy if exists rls_staff_minors_update on public.staff_minors;
create policy rls_staff_minors_update on public.staff_minors for update to authenticated
  using ((select public.app_role()) = 'Admin') with check ((select public.app_role()) = 'Admin');

-- Under 18 on the Berlin day: no birthday known = the tick alone counts
create or replace function public.minor_today(p_birth date)
returns boolean language sql stable set search_path = public as $$
  select p_birth is null or p_birth > ((now() at time zone 'Europe/Berlin')::date - interval '18 years')::date;
$$;

create or replace function public.i_am_minor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_minors where user_id = (select auth.uid()) and public.minor_today(birth_date));
$$;

create or replace function public.minors_among(p_ids uuid[])
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.user_id from public.staff_minors m
   where m.user_id = any (coalesce(p_ids, '{}')) and public.minor_today(m.birth_date)
     and ((select public.sees_plan_interest()) or (select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin'));
$$;

revoke all on function public.minor_today(date) from public, anon;
grant execute on function public.minor_today(date) to authenticated, service_role;

-- 18th birthday: the tick (and the birthday) go away
select cron.schedule('end-minors-daily', '10 0 * * *', $$
  delete from public.staff_minors where not public.minor_today(birth_date);
$$);

update public.app_settings set value = '2'::jsonb where key = 'inactive_months' and value = '3'::jsonb;
