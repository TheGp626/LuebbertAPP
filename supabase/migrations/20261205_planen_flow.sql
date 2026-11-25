-- PLANEN flow (spec docs/superpowers/specs/2026-11-25-planen-flow-design.md):
-- 1. planner_order_phases(): every Auftrag phase for the planners, also before an MA number is entered (order_slots()
--    keeps hiding those, the Wochenplan „Ich kann“ needs MA > 0). Planung (plans_week), PL and Admin only.
-- 2. plan_draft_shifts: manual (fields a person changed by hand, a revised Bestätigung leaves them alone),
--    auftrag_changes (what a revised Bestätigung changed, shown until someone taps „Gesehen“), pair_id (Aufbau + Abbau
--    of one quick Einsatz).
-- 3. order_staffing: Planung may set MA numbers too.
-- Rollback: supabase/rollback/20261205_planen_flow_rollback.sql. Check: supabase/tests/planen_flow_check.sql.

create or replace function public.planner_order_phases()
returns table (job_no text, phase text, name text, title text, room text, start_at text, end_at text,
  materials jsonb, notes text, needed int, accepted int, accepted_ids uuid[], my_status text, link_date date, link_key text, link_set boolean)
language sql stable security definer set search_path = public as $$
  with jobs as (
    select distinct on (j->>'jobNo') j->>'jobNo' as jno, j as job, p.result->>'title' as ttl
    from public.order_parsed p
    join public.folder_files f on f.id = p.file_id
    cross join lateral jsonb_array_elements(coalesce(p.result->'jobs', '[]'::jsonb)) j
    where (select public.plans_week()) or (select public.app_role()) in ('PL', 'Admin')
    order by j->>'jobNo', f.created_at desc
  ), ov as (
    -- earliest active Einsatz tagged with the job phase (folder form) replaces the day of the Bestätigung
    select e.job_no, e.phase, min(e.date) as d from public.einsaetze e
    where e.job_no is not null and not e.cancelled group by e.job_no, e.phase
  ), raw as (
    select jb.jno, x.ph, jb.job, jb.ttl,
      (jb.job->x.ph)->>'start' as st0, (jb.job->x.ph)->>'end' as en0, o.d,
      case x.ph when 'setup' then s.staff_setup else s.staff_teardown end as nd
    from jobs jb
    left join public.order_staffing s on s.job_no = jb.jno
    cross join (values ('setup'), ('teardown')) as x(ph)
    left join ov o on o.job_no = jb.jno and o.phase = x.ph
  ), ph as (
    -- same rule as ordShiftRange (order-slots.js): times stay, a later end moves by the same number of days
    select r.*,
      case when r.d is null or r.st0 !~ '^\d{4}-\d{2}-\d{2}' then r.st0 else to_char(r.d, 'YYYY-MM-DD') || substr(r.st0, 11) end as st,
      case when r.d is null or r.st0 !~ '^\d{4}-\d{2}-\d{2}' or r.en0 !~ '^\d{4}-\d{2}-\d{2}' then r.en0
        else to_char(left(r.en0, 10)::date + (r.d - left(r.st0, 10)::date), 'YYYY-MM-DD') || substr(r.en0, 11) end as en
    from raw r
  )
  select ph.jno, ph.ph, ph.job->>'name', ph.ttl, ph.job->>'room', ph.st, ph.en,
    coalesce(ph.job->'materials', '[]'::jsonb), ph.job->>'notes', ph.nd::int,
    (select count(*)::int from public.order_applications a where a.job_no = ph.jno and a.phase = ph.ph and a.status = 'angenommen'),
    (select coalesce(array_agg(a.user_id), '{}') from public.order_applications a where a.job_no = ph.jno and a.phase = ph.ph and a.status = 'angenommen'),
    (select a.status from public.order_applications a where a.job_no = ph.jno and a.phase = ph.ph and a.user_id = auth.uid()),
    l.plan_date, l.plan_key, l.job_no is not null
  from ph
  left join public.order_plan_links l on l.job_no = ph.jno and l.phase = ph.ph
  -- ISO text compares like a date; no cast, so one malformed parse can't break the RPC for everyone
  -- also phases without an MA number (needed null or 0) and the days already past in this week
  where ph.st ~ '^\d{4}-\d{2}-\d{2}' and left(ph.st, 10) >= to_char(current_date - 7, 'YYYY-MM-DD')
  order by ph.st, ph.jno, ph.ph;
$$;
revoke all on function public.planner_order_phases() from public, anon;
grant execute on function public.planner_order_phases() to authenticated, service_role;

alter table public.plan_draft_shifts
  add column if not exists manual text[] not null default '{}',
  add column if not exists auftrag_changes jsonb,
  add column if not exists pair_id uuid;

drop policy if exists rls_order_staffing_insert on public.order_staffing;
create policy rls_order_staffing_insert on public.order_staffing for insert to authenticated
  with check ((select public.app_role()) in ('Admin', 'PL') or (select public.plans_week()));
drop policy if exists rls_order_staffing_update on public.order_staffing;
create policy rls_order_staffing_update on public.order_staffing for update to authenticated
  using ((select public.app_role()) in ('Admin', 'PL') or (select public.plans_week()))
  with check ((select public.app_role()) in ('Admin', 'PL') or (select public.plans_week()));
