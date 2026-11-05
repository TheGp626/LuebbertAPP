-- "Ich hätte Zeit" only for an open slot the person fits (2026-11-05, Patryk: "no normal MAs for a shift that only requires a Fahrer").
-- AL slot: AL/PL/Admin. Fahrer slot: app_users.can_drive. MA, Zenjob, ROCKiT and any other slot: everyone (not Gast, see insert policy).
-- can_drive is pre-filled for everyone with default department Fahrer or a past plan assignment as Fahrer; PL/Buchhaltung/Admin edit it.
-- Rollback: supabase/rollback/20261105_plan_interest_slot_fit_rollback.sql. Check: supabase/tests/plan_slot_fit_check.sql.
alter table public.app_users add column can_drive boolean not null default false;

update public.app_users u set can_drive = true
 where u.default_dept = 'Fahrer'
    or exists (select 1 from public.plan_assignments a where a.user_id = u.id and a.role = 'Fahrer');

create function public.fits_plan_slot(p_week uuid, p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.plan_shifts s, jsonb_array_elements(coalesce(s.open_slots, '[]'::jsonb)) o
     where s.week_id = p_week and s.key = p_key
       and case coalesce(o->>'role', 'MA')
             when 'AL' then (select public.app_role()) in ('AL', 'PL', 'Admin')
             when 'Fahrer' then exists (select 1 from public.app_users where id = (select auth.uid()) and can_drive)
             else true
           end);
$$;
revoke all on function public.fits_plan_slot(uuid, text) from public, anon;
grant execute on function public.fits_plan_slot(uuid, text) to authenticated;

drop policy rls_plan_shift_interest_insert on public.plan_shift_interest;
create policy rls_plan_shift_interest_insert on public.plan_shift_interest for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.app_role()) <> 'Gast'
              and public.fits_plan_slot(week_id, shift_key));
