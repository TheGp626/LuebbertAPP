-- Absagen: someone planned on a published shift says "Ich kann doch nicht". The planner sees it at the row in the
-- Besetzungsplaner with replacements suggested, swaps the person and publishes as usual (the new person gets the push).
-- Keyed like plan_shift_interest by week + plan key (shift ids change with every upload). No reason is stored on purpose.
-- No push for an Absage: the app asks people to call their PL as well when the shift is today or tomorrow.
-- Rollback: supabase/rollback/20261111_absagen_rollback.sql. Check: supabase/tests/absagen_check.sql.

create table public.plan_cancellations (
  week_id uuid not null references public.plan_weeks(id) on delete cascade,
  shift_key text not null,
  user_id uuid not null references public.app_users(id) on delete cascade,
  status text not null default 'offen' check (status in ('offen', 'erledigt')),
  created_at timestamptz not null default now(),
  decided_by uuid references public.app_users(id) on delete set null,
  decided_at timestamptz,
  replacement_user_id uuid references public.app_users(id) on delete set null,
  primary key (week_id, shift_key, user_id)
);
create index plan_cancellations_user_id_idx on public.plan_cancellations (user_id);
create index plan_cancellations_decided_by_idx on public.plan_cancellations (decided_by);
create index plan_cancellations_replacement_user_id_idx on public.plan_cancellations (replacement_user_id);
alter table public.plan_cancellations enable row level security;
revoke all on public.plan_cancellations from public, anon;
grant select, insert, update, delete on public.plan_cancellations to authenticated;
grant all on public.plan_cancellations to service_role;

-- Own Absagen, and everyone who plans (planner switch, PL, Admin)
create policy rls_plan_cancellations_select on public.plan_cancellations for select to authenticated
  using (user_id = (select auth.uid()) or (select public.plans_week()) or (select public.app_role()) in ('PL', 'Admin'));
-- Only for oneself, only on a shift one is actually planned on, and not for a day that is over
create policy rls_plan_cancellations_insert on public.plan_cancellations for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.app_role()) <> 'Gast'
    and status = 'offen' and decided_by is null and decided_at is null and replacement_user_id is null
    and exists (select 1 from public.plan_shifts s join public.plan_assignments a on a.shift_id = s.id
                where s.week_id = plan_cancellations.week_id and s.key = plan_cancellations.shift_key
                  and a.user_id = (select auth.uid()) and s.date >= (now() at time zone 'Europe/Berlin')::date));
-- Handling (erledigt, replacement) is for those who plan
create policy rls_plan_cancellations_update on public.plan_cancellations for update to authenticated
  using ((select public.plans_week()) or (select public.app_role()) in ('PL', 'Admin'))
  with check ((select public.plans_week()) or (select public.app_role()) in ('PL', 'Admin'));
-- Withdraw an open one oneself; planners may clean up
create policy rls_plan_cancellations_delete on public.plan_cancellations for delete to authenticated
  using ((user_id = (select auth.uid()) and status = 'offen') or (select public.plans_week()) or (select public.app_role()) in ('PL', 'Admin'));

-- Who handled it and when comes from the server
create function public.plan_cancellations_decided() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.decided_by := case when new.status = 'offen' then null else auth.uid() end;
    new.decided_at := case when new.status = 'offen' then null else now() end;
  end if;
  return new;
end $$;
create trigger plan_cancellations_decided before update on public.plan_cancellations
  for each row execute function public.plan_cancellations_decided();
