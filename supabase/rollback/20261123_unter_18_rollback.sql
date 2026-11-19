-- Rollback of 20261123_unter_18.sql (back to 20261120_mitarbeiter_pflegen)
select cron.unschedule('end-minors-daily');

create or replace function public.i_am_minor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_minors where user_id = (select auth.uid()));
$$;

create or replace function public.minors_among(p_ids uuid[])
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.user_id from public.staff_minors m
   where m.user_id = any (coalesce(p_ids, '{}')) and (select public.sees_plan_interest());
$$;

drop function if exists public.minor_today(date);
drop policy if exists rls_staff_minors_update on public.staff_minors;
revoke update on public.staff_minors from authenticated;
alter table public.staff_minors drop column if exists birth_date;
update public.app_settings set value = '3'::jsonb where key = 'inactive_months' and value = '2'::jsonb;
