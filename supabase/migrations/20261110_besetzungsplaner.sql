-- Besetzungsplaner: the weekly plan is drafted in the app (plan_draft_weeks / plan_draft_shifts) and published
-- through the same tables Daniel's PDF import fills (plan_weeks / plan_shifts / plan_assignments).
-- Additive only: no existing policy is replaced. Per-user switch app_users.plans_week ("Plant den Wochenplan");
-- only an Admin sets it (trigger app_users_plans_week_guard). Spec: docs/superpowers/specs/2026-11-10-besetzungsplaner-design.md (local).
-- Rollback: supabase/rollback/20261110_besetzungsplaner_rollback.sql. Check: supabase/tests/besetzungsplaner_check.sql.

alter table public.app_users add column plans_week boolean not null default false;

-- Planner = Admin always, anyone else (PL included) only with the switch
create function public.plans_week() returns boolean
language sql stable security definer set search_path = public as $$
  select (select public.app_role()) = 'Admin'
    or exists (select 1 from public.app_users where id = (select auth.uid()) and is_active is not false and plans_week);
$$;
revoke all on function public.plans_week() from public, anon;
grant execute on function public.plans_week() to authenticated, service_role;

-- app_users UPDATE is open to PL/Buchhaltung/Admin: without this a PL could switch themselves on
create function public.app_users_plans_week_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if new.plans_week is not distinct from old.plans_week then return new; end if;
  if auth.uid() is null or claims ->> 'role' = 'service_role' or public.app_role() = 'Admin' then return new; end if;
  raise exception '„Plant den Wochenplan“ kann nur ein Admin ändern' using errcode = 'insufficient_privilege';
end $$;
revoke execute on function public.app_users_plans_week_guard() from public, anon, authenticated;
create trigger app_users_plans_week_guard before update on public.app_users
  for each row execute function public.app_users_plans_week_guard();

-- One draft per ISO week. published_version = plan_weeks.version right after the draft was published;
-- a later PDF upload bumps plan_weeks.version, so the week counts as a PDF week again.
create table public.plan_draft_weeks (
  year integer not null,
  kw integer not null check (kw between 1 and 53),
  week_start date not null,
  week_end date not null,
  published_version integer,
  published_at timestamptz,
  published_by uuid references public.app_users(id) on delete set null,
  created_by uuid references public.app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (year, kw)
);
alter table public.plan_draft_weeks enable row level security;

create policy rls_plan_draft_weeks_select on public.plan_draft_weeks for select to authenticated
  using ((select public.plans_week()) or (select public.app_role()) = 'PL');
create policy rls_plan_draft_weeks_insert on public.plan_draft_weeks for insert to authenticated
  with check (((select public.plans_week()) or (select public.app_role()) = 'PL') and published_version is null);
create policy rls_plan_draft_weeks_update on public.plan_draft_weeks for update to authenticated
  using ((select public.plans_week())) with check ((select public.plans_week()));
create policy rls_plan_draft_weeks_delete on public.plan_draft_weeks for delete to authenticated
  using ((select public.plans_week()));
grant select, insert, update, delete on public.plan_draft_weeks to authenticated;
grant all on public.plan_draft_weeks to service_role;

-- One row per shift of the draft. Text columns hold what Daniel's table holds (lines joined by \n, as in plan_shifts).
-- job_no/phase mark a row that came from an Auftragsbestätigung; people = [{user_id, name, role, note}].
create table public.plan_draft_shifts (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  kw integer not null,
  date date not null,
  sort integer not null default 0,
  job_no text check (job_no ~ '^\d{2}-\d{4}\.\d{2}$'),
  phase text check (phase in ('setup', 'teardown')),
  venue text,
  location text,
  title text,
  details text,
  wann text,
  ap text,
  ap_user_id uuid references public.app_users(id) on delete set null,
  notes text,
  need smallint check (need between 0 and 99),
  people jsonb not null default '[]'::jsonb check (jsonb_typeof(people) = 'array'),
  updated_by uuid references public.app_users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (year, kw) references public.plan_draft_weeks(year, kw) on delete cascade,
  constraint plan_draft_shifts_job_phase_both check ((job_no is null) = (phase is null)),
  constraint plan_draft_shifts_job_once unique (year, kw, job_no, phase)
);
create index plan_draft_shifts_week_idx on public.plan_draft_shifts (year, kw);
create index plan_draft_shifts_ap_user_id_idx on public.plan_draft_shifts (ap_user_id);
create index plan_draft_shifts_updated_by_idx on public.plan_draft_shifts (updated_by);
alter table public.plan_draft_shifts enable row level security;

-- A PL fills Auftrag rows whose AP is empty or themselves; free rows, deleting and everything else is the planner's
create policy rls_plan_draft_shifts_select on public.plan_draft_shifts for select to authenticated
  using ((select public.plans_week()) or (select public.app_role()) = 'PL');
create policy rls_plan_draft_shifts_insert on public.plan_draft_shifts for insert to authenticated
  with check ((select public.plans_week())
    or ((select public.app_role()) = 'PL' and job_no is not null and (ap_user_id is null or ap_user_id = (select auth.uid()))));
create policy rls_plan_draft_shifts_update on public.plan_draft_shifts for update to authenticated
  using ((select public.plans_week())
    or ((select public.app_role()) = 'PL' and job_no is not null and (ap_user_id is null or ap_user_id = (select auth.uid()))))
  with check ((select public.plans_week())
    or ((select public.app_role()) = 'PL' and job_no is not null and (ap_user_id is null or ap_user_id = (select auth.uid()))));
create policy rls_plan_draft_shifts_delete on public.plan_draft_shifts for delete to authenticated
  using ((select public.plans_week()));
grant select, insert, update, delete on public.plan_draft_shifts to authenticated;
grant all on public.plan_draft_shifts to service_role;

-- Who changed a row and when comes from the server (the app saves with "where updated_at = what I loaded")
create function public.plan_draft_shifts_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := clock_timestamp();
  return new;
end $$;
create trigger plan_draft_shifts_touch before insert or update on public.plan_draft_shifts
  for each row execute function public.plan_draft_shifts_touch();

-- Publishing writes the plan tables like a PDF upload does. PL/Admin already may (rls_<table>_<cmd> from role_rls);
-- these extra permissive policies let a planner without the PL role do the same. Reading is open to every non-guest already.
create policy rls_plan_weeks_insert_planner on public.plan_weeks for insert to authenticated with check ((select public.plans_week()));
create policy rls_plan_weeks_update_planner on public.plan_weeks for update to authenticated
  using ((select public.plans_week())) with check ((select public.plans_week()));
create policy rls_plan_weeks_delete_planner on public.plan_weeks for delete to authenticated using ((select public.plans_week()));
create policy rls_plan_shifts_insert_planner on public.plan_shifts for insert to authenticated with check ((select public.plans_week()));
create policy rls_plan_shifts_update_planner on public.plan_shifts for update to authenticated
  using ((select public.plans_week())) with check ((select public.plans_week()));
create policy rls_plan_shifts_delete_planner on public.plan_shifts for delete to authenticated using ((select public.plans_week()));
create policy rls_plan_assignments_insert_planner on public.plan_assignments for insert to authenticated with check ((select public.plans_week()));
create policy rls_plan_assignments_update_planner on public.plan_assignments for update to authenticated
  using ((select public.plans_week())) with check ((select public.plans_week()));
create policy rls_plan_assignments_delete_planner on public.plan_assignments for delete to authenticated using ((select public.plans_week()));
-- Fixed link Auftrag phase → published plan row, so the Auftrag block sits on the right entry without guessing
create policy rls_order_plan_links_insert_planner on public.order_plan_links for insert to authenticated with check ((select public.plans_week()));
create policy rls_order_plan_links_update_planner on public.order_plan_links for update to authenticated
  using ((select public.plans_week())) with check ((select public.plans_week()));
