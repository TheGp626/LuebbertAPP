-- Verfügbarkeit: unlocked workers block days ('nein' = geht nicht, 'notfall' = nur im Notfall); no row = available.
-- Planners (Admin or plan_interest_viewer, see sees_plan_interest()) read everyone's rows and get the people list
-- via availability_people(). Spec: docs/superpowers/specs/2026-11-06-verfuegbarkeit-design.md (local).
-- Rollback: supabase/rollback/20261106_verfuegbarkeit_rollback.sql. Check: supabase/tests/verfuegbarkeit_check.sql.

create table public.availability (
  user_id uuid not null references public.app_users(id) on delete cascade,
  day date not null,
  level text not null check (level in ('nein', 'notfall')),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.availability enable row level security;

create policy rls_availability_select on public.availability for select to authenticated
  using (user_id = (select auth.uid()) or (select public.sees_plan_interest()));
create policy rls_availability_insert on public.availability for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.app_role()) <> 'Gast' and day >= current_date);
create policy rls_availability_update on public.availability for update to authenticated
  using (user_id = (select auth.uid()) and day >= current_date)
  with check (user_id = (select auth.uid()) and (select public.app_role()) <> 'Gast' and day >= current_date);
create policy rls_availability_delete on public.availability for delete to authenticated
  using (user_id = (select auth.uid()) and day >= current_date);

grant select, insert, update, delete on public.availability to authenticated;

alter table public.app_users add column availability_enabled boolean not null default false;

insert into public.app_settings (key, value) values ('availability_for_all', 'false'::jsonb) on conflict (key) do nothing;

-- Rows of the planner grid: unlocked active non-guests (all active non-guests while availability_for_all is on);
-- empty for anyone who may not see the overview
create function public.availability_people()
returns table(id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.full_name from public.app_users u
  where (select public.sees_plan_interest())
    and u.is_active is not false and u.role <> 'Gast'
    and (u.availability_enabled
         or coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'availability_for_all'), false))
  order by u.full_name;
$$;
revoke all on function public.availability_people() from public, anon;
grant execute on function public.availability_people() to authenticated;

-- apply_app_settings has a fixed key whitelist: add availability_for_all to its boolean keys (rest unchanged)
do $$
declare def text := pg_get_functiondef('public.apply_app_settings(jsonb,uuid)'::regprocedure);
declare nd text := replace(def, '''folder_autodelete_enabled'')', '''folder_autodelete_enabled'', ''availability_for_all'')');
begin
  if nd = def then raise exception 'apply_app_settings: whitelist anchor not found'; end if;
  execute nd;
end $$;
