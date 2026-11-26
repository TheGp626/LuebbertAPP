-- Anwesenheit / No-Shows (Jenni, Briefing 26.11.2026, Priorität 1): the AL sets per person in the protocol
-- erschienen (default, no row) · verspätet · kurzfristig abgesagt (< 24 h) · krank · nicht erschienen.
-- protocol_attendance keeps the non-default statuses; people who did not work have no shift (no hours, no cost).
-- set_protocol_attendance() replaces a protocol's list in one call and keeps alerted_at of unchanged rows, so the
-- push to the Personalteam (Edge Function notify-attendance) goes out once per person and status.
-- attendance_alerts() lists the last days' Ausfälle for Admin, PL and „Sieht Bewerbungen“ (Personalteam until that role exists).
-- Rollback: supabase/rollback/20261210_anwesenheit_rollback.sql. Check: supabase/tests/anwesenheit_check.sql.

create table public.protocol_attendance (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.protocols(id) on delete cascade,
  user_id uuid references public.app_users(id) on delete cascade,
  temp_worker_name text check (temp_worker_name is null or char_length(btrim(temp_worker_name)) between 1 and 80),
  status text not null check (status in ('verspaetet', 'abgesagt', 'krank', 'nicht_erschienen')),
  created_by uuid default auth.uid() references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  alerted_at timestamptz,
  check ((user_id is null) <> (temp_worker_name is null))
);
create unique index protocol_attendance_person on public.protocol_attendance
  (protocol_id, coalesce(user_id::text, 'n:' || lower(btrim(temp_worker_name))));
create index protocol_attendance_user on public.protocol_attendance (user_id);

alter table public.protocol_attendance enable row level security;
revoke all on public.protocol_attendance from public, anon, authenticated;
grant select on public.protocol_attendance to authenticated;
grant all on public.protocol_attendance to service_role;
-- Read like the protocol itself; writes only through set_protocol_attendance
create policy rls_protocol_attendance_select on public.protocol_attendance for select to authenticated
  using ((select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin'));

-- rows: [{ "user_id": uuid | null, "name": text | null, "status": text }]; anything not in rows is removed
create or replace function public.set_protocol_attendance(p_protocol uuid, rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if (select public.app_role()) not in ('AL', 'PL', 'Buchhaltung', 'Admin') then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
  if rows is null or jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 200 then
    raise exception 'invalid_rows';
  end if;
  if not exists (select 1 from public.protocols where id = p_protocol) then raise exception 'protocol_not_found'; end if;

  drop table if exists pg_temp._att;
  create temp table _att on commit drop as
    select distinct on (k) nullif(r ->> 'user_id', '')::uuid as user_id,
           case when nullif(r ->> 'user_id', '') is null then nullif(btrim(r ->> 'name'), '') end as temp_worker_name,
           r ->> 'status' as status,
           coalesce(nullif(r ->> 'user_id', ''), 'n:' || lower(btrim(r ->> 'name'))) as k
      from jsonb_array_elements(rows) r
     where coalesce(nullif(r ->> 'user_id', ''), nullif(btrim(r ->> 'name'), '')) is not null;

  delete from public.protocol_attendance a where a.protocol_id = p_protocol
    and not exists (select 1 from _att t where t.k = coalesce(a.user_id::text, 'n:' || lower(btrim(a.temp_worker_name))));
  update public.protocol_attendance a set status = t.status, alerted_at = null
    from _att t where a.protocol_id = p_protocol and a.status <> t.status
     and t.k = coalesce(a.user_id::text, 'n:' || lower(btrim(a.temp_worker_name)));
  insert into public.protocol_attendance (protocol_id, user_id, temp_worker_name, status)
    select p_protocol, t.user_id, t.temp_worker_name, t.status from _att t
     where not exists (select 1 from public.protocol_attendance a where a.protocol_id = p_protocol
                         and t.k = coalesce(a.user_id::text, 'n:' || lower(btrim(a.temp_worker_name))));
  select count(*) into n from public.protocol_attendance where protocol_id = p_protocol;
  return n;
end $$;
revoke all on function public.set_protocol_attendance(uuid, jsonb) from public, anon;
grant execute on function public.set_protocol_attendance(uuid, jsonb) to authenticated;

create or replace function public.attendance_alerts(p_days integer default 14)
returns table (id uuid, protocol_id uuid, status text, name text, user_id uuid, date date, job_no text, project text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.protocol_id, a.status, coalesce(u.full_name, a.temp_worker_name), a.user_id, p.date, p.job_no, pr.name, a.created_at
    from public.protocol_attendance a
    join public.protocols p on p.id = a.protocol_id
    left join public.projects pr on pr.id = p.project_id
    left join public.app_users u on u.id = a.user_id
   where (public.sees_plan_interest() or (select public.app_role()) = 'PL')
     and a.status in ('abgesagt', 'krank', 'nicht_erschienen')
     and a.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90))
   order by p.date desc, a.created_at desc
   limit 100;
$$;
revoke all on function public.attendance_alerts(integer) from public, anon;
grant execute on function public.attendance_alerts(integer) to authenticated;
