-- Personal PIN login: lockout bookkeeping, reset log, name list for the login screen,
-- and mirror of every anon policy / function grant to the role `authenticated`
-- (after login all requests run as `authenticated`, which must be able to do what `anon` did).

create table if not exists public.pin_lockouts (
  user_id      uuid primary key references public.app_users(id) on delete cascade,
  failed_count int not null default 0,
  locked_until timestamptz
);
create table if not exists public.pin_reset_log (
  id         bigint generated always as identity primary key,
  reset_by   uuid not null,
  target     uuid not null,
  created_at timestamptz not null default now()
);
alter table public.pin_lockouts enable row level security;
alter table public.pin_reset_log enable row level security;
revoke all on public.pin_lockouts from anon, authenticated;
revoke all on public.pin_reset_log from anon, authenticated;

-- Atomic failure counter (parallel wrong PINs cannot overwrite each other); the row lock serialises per user.
-- An active lock is never extended or counted further. Reaching p_max locks and resets the counter.
create or replace function public.pin_register_failure(p_user_id uuid, p_max int, p_lock_min int)
returns public.pin_lockouts
language plpgsql security definer set search_path = public as $$
declare r public.pin_lockouts;
begin
  insert into public.pin_lockouts as t (user_id, failed_count) values (p_user_id, 1)
  on conflict (user_id) do update set failed_count =
    case when t.locked_until > now() then t.failed_count else t.failed_count + 1 end
  returning * into r;
  if r.failed_count >= p_max then
    update public.pin_lockouts set failed_count = 0, locked_until = now() + make_interval(mins => p_lock_min)
    where user_id = p_user_id returning * into r;
  end if;
  return r;
end $$;
revoke all on function public.pin_register_failure(uuid, int, int) from public, anon, authenticated;
grant execute on function public.pin_register_failure(uuid, int, int) to service_role;

-- Only id, name, role and "has a PIN"; never rates or emails
create or replace function public.login_names()
returns table(id uuid, full_name text, role text, has_pin boolean)
language sql stable security definer set search_path = public as $$
  select u.id, u.full_name, u.role, exists(select 1 from auth.users a where a.id = u.id)
  from public.app_users u
  where u.is_active is null or u.is_active
  order by u.full_name
$$;
grant execute on function public.login_names() to anon, authenticated;

-- Mirror anon-only policies (schemas public + storage) to authenticated
do $$
declare
  p record;
  f record;
  stmt text;
begin
  for p in
    select * from pg_policies
    where schemaname in ('public', 'storage') and roles = array['anon']::name[]
  loop
    if exists (select 1 from pg_policies x
               where x.schemaname = p.schemaname and x.tablename = p.tablename and x.policyname = left(p.policyname || '_auth', 63)) then
      continue;
    end if;
    stmt := format('create policy %I on %I.%I as %s for %s to authenticated',
                   left(p.policyname || '_auth', 63), p.schemaname, p.tablename, lower(p.permissive), p.cmd);
    if p.qual is not null then stmt := stmt || format(' using (%s)', p.qual); end if;
    if p.with_check is not null then stmt := stmt || format(' with check (%s)', p.with_check); end if;
    execute stmt;
  end loop;

  for f in
    select pr.oid::regprocedure as sig
    from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public' and pr.prokind in ('f', 'p') and has_function_privilege('anon', pr.oid, 'execute')
  loop
    execute format('grant execute on routine %s to authenticated', f.sig);
  end loop;

  -- Table / sequence privileges: several tables grant anon rights that authenticated lacks (policies alone don't help)
  for f in
    select c.oid::regclass as rel, pv
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['select', 'insert', 'update', 'delete']) pv
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'p')
      and c.relname not in ('pin_lockouts', 'pin_reset_log')
      and has_table_privilege('anon', c.oid, pv) and not has_table_privilege('authenticated', c.oid, pv)
  loop
    execute format('grant %s on %s to authenticated', f.pv, f.rel);
  end loop;
  for f in
    select c.oid::regclass as rel, pv
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['usage', 'select', 'update']) pv
    where n.nspname = 'public' and c.relkind = 'S'
      and has_sequence_privilege('anon', c.oid, pv) and not has_sequence_privilege('authenticated', c.oid, pv)
  loop
    execute format('grant %s on sequence %s to authenticated', f.pv, f.rel);
  end loop;
end $$;

-- Verification (must return 0 rows after applying):
-- select a.schemaname, a.tablename, a.cmd from pg_policies a
-- where a.schemaname in ('public','storage') and 'anon' = any(a.roles)
--   and not exists (select 1 from pg_policies b where b.schemaname = a.schemaname and b.tablename = a.tablename
--                   and b.cmd = a.cmd and ('authenticated' = any(b.roles) or 'public' = any(b.roles)))
-- group by 1,2,3;
