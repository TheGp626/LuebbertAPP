-- MA say "Ich hätte Zeit" for a published plan shift with open slots; PL/Admin (plan builders) see who.
-- Keyed by week + plan key, not plan_shifts.id: shift ids change with every upload, week id and key stay.
-- Rollback: supabase/rollback/20261104_plan_shift_interest_rollback.sql. Check: supabase/tests/plan_shift_interest_check.sql.
create table public.plan_shift_interest (
  week_id uuid not null references public.plan_weeks(id) on delete cascade,
  shift_key text not null,
  user_id uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (week_id, shift_key, user_id)
);
create index plan_shift_interest_user_id_idx on public.plan_shift_interest (user_id);
alter table public.plan_shift_interest enable row level security;
revoke all on public.plan_shift_interest from public, anon;
grant select, insert, delete on public.plan_shift_interest to authenticated;
grant all on public.plan_shift_interest to service_role;
create policy rls_plan_shift_interest_select on public.plan_shift_interest for select to authenticated
  using (user_id = (select auth.uid()) or (select public.app_role()) in ('PL', 'Admin'));
create policy rls_plan_shift_interest_insert on public.plan_shift_interest for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.app_role()) <> 'Gast');
create policy rls_plan_shift_interest_delete on public.plan_shift_interest for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.app_role()) in ('PL', 'Admin'));
