-- Role-based rights, migration 1 (prepare, additive): nothing existing changes behaviour.
-- Adds app_user_private (sensitive per-user columns), app_role(), user_directory(), renew_calendar_token().
-- Temporary policy rls_app_user_private_tmp is removed by migration 2.

create table if not exists public.app_user_private (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  hourly_rate_conni numeric,
  income_limit numeric,
  email text
);

insert into public.app_user_private (user_id, hourly_rate_conni, income_limit, email)
select id, hourly_rate_conni, income_limit, email from public.app_users
on conflict do nothing;

alter table public.app_user_private enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'app_user_private' and policyname = 'rls_app_user_private_tmp') then
    create policy rls_app_user_private_tmp on public.app_user_private
      for all to authenticated using (true) with check (true);
  end if;
end $$;

grant select, insert, update, delete on public.app_user_private to authenticated, service_role;
revoke all on public.app_user_private from anon;

-- Caller's role; 'Gast' when not logged in, unknown or inactive. security definer: usable inside RLS on app_users itself.
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.app_users where id = auth.uid() and is_active is not false),
    'Gast');
$$;

create or replace function public.user_directory()
returns table(id uuid, full_name text, role text, is_active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.full_name, u.role, u.is_active from public.app_users u order by u.full_name;
$$;

create or replace function public.renew_calendar_token()
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  t uuid;
begin
  update public.app_users set calendar_token = gen_random_uuid()
  where id = auth.uid() returning calendar_token into t;
  if t is null then
    raise exception 'not logged in';
  end if;
  return t;
end;
$$;

revoke execute on function public.app_role(), public.user_directory(), public.renew_calendar_token() from public, anon;
grant execute on function public.app_role(), public.user_directory(), public.renew_calendar_token() to authenticated, service_role;
