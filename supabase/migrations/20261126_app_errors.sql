-- Fehlerberichte (22.11.2026): automatic error capture + "Problem melden"
-- 1. app_errors: one row per bug (fingerprint = scrubbed message + first stack frame, no app version), with count,
--    users_affected and the versions it was seen on. app_error_users counts distinct users.
-- 2. bug_reports: what a person typed in "Problem melden", plus technical context if they left the tick on.
-- 3. Clients never write the tables: log_error() / report_problem() (security definer) validate, cut and rate-limit
--    (also for old cached clients). Logged-out callers (PIN screen) are allowed with a tighter shared limit.
-- 4. Only Admin reads; Admin may change status (and fixed_in). Everything older than 90 days goes (cron).
-- The client scrubs names, numbers and quoted values before sending; the server only cuts lengths.
-- Rollback: supabase/rollback/20261126_app_errors_rollback.sql. Check: supabase/tests/app_errors_check.sql.

create table if not exists public.app_errors (
  fingerprint      text primary key,
  message          text not null default '',
  stack            text,
  source           text not null default 'catch' check (source in ('window', 'promise', 'catch')),
  where_           text,
  versions         text[] not null default '{}',
  last_version     text,
  count            int not null default 1,
  users_affected   int not null default 0,
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  last_user_id     uuid references public.app_users(id) on delete set null,
  last_role        text,
  last_device      text,
  last_breadcrumbs jsonb,
  last_context     jsonb,
  status           text not null default 'neu' check (status in ('neu', 'gesehen', 'behoben', 'ignoriert')),
  fixed_in         text
);
create index if not exists app_errors_last_seen_idx on public.app_errors (last_seen desc);

create table if not exists public.app_error_users (
  fingerprint text not null references public.app_errors(fingerprint) on delete cascade,
  user_id     uuid not null references public.app_users(id) on delete cascade,
  primary key (fingerprint, user_id)
);

create table if not exists public.bug_reports (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  user_id      uuid references public.app_users(id) on delete set null,
  role         text,
  wanted       text not null default '',
  happened     text not null default '',
  context      jsonb,
  fingerprints text[] not null default '{}',
  status       text not null default 'neu' check (status in ('neu', 'gesehen', 'behoben', 'ignoriert'))
);
create index if not exists bug_reports_created_idx on public.bug_reports (created_at desc);

-- Calls per caller and hour; bucket = user id or 'anon' (all logged-out callers share one bucket)
create table if not exists public.app_error_rate (
  bucket text not null,
  kind   text not null,
  hour   timestamptz not null,
  n      int not null default 0,
  primary key (bucket, kind, hour)
);

alter table public.app_errors      enable row level security;
alter table public.app_error_users enable row level security;
alter table public.bug_reports     enable row level security;
alter table public.app_error_rate  enable row level security;

revoke all on public.app_errors, public.app_error_users, public.bug_reports, public.app_error_rate from anon, authenticated;
grant select on public.app_errors, public.app_error_users, public.bug_reports to authenticated;
grant update (status, fixed_in) on public.app_errors to authenticated;
grant update (status) on public.bug_reports to authenticated;

drop policy if exists rls_app_errors_select on public.app_errors;
create policy rls_app_errors_select on public.app_errors for select to authenticated
  using ((select public.app_role()) = 'Admin');
drop policy if exists rls_app_errors_update on public.app_errors;
create policy rls_app_errors_update on public.app_errors for update to authenticated
  using ((select public.app_role()) = 'Admin') with check ((select public.app_role()) = 'Admin');
drop policy if exists rls_app_error_users_select on public.app_error_users;
create policy rls_app_error_users_select on public.app_error_users for select to authenticated
  using ((select public.app_role()) = 'Admin');
drop policy if exists rls_bug_reports_select on public.bug_reports;
create policy rls_bug_reports_select on public.bug_reports for select to authenticated
  using ((select public.app_role()) = 'Admin');
drop policy if exists rls_bug_reports_update on public.bug_reports;
create policy rls_bug_reports_update on public.bug_reports for update to authenticated
  using ((select public.app_role()) = 'Admin') with check ((select public.app_role()) = 'Admin');
-- app_error_rate: no policies, only the definer functions touch it

-- One more call in this hour; true while under the limit
create or replace function public.app_error_rate_ok(p_kind text, p_user_max int, p_anon_max int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_bucket text := coalesce((select auth.uid())::text, 'anon');
  v_n int;
begin
  insert into public.app_error_rate (bucket, kind, hour, n) values (v_bucket, p_kind, date_trunc('hour', now()), 1)
  on conflict (bucket, kind, hour) do update set n = public.app_error_rate.n + 1
  returning public.app_error_rate.n into v_n;
  return v_n <= case when v_bucket = 'anon' then p_anon_max else p_user_max end;
end $$;
revoke all on function public.app_error_rate_ok(text, int, int) from public, anon, authenticated;

create or replace function public.log_error(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid;
  v_fp   text := left(nullif(btrim(coalesce(p->>'fingerprint', '')), ''), 64);
  v_ver  text := left(coalesce(nullif(btrim(p->>'version'), ''), '?'), 60);
  v_src  text := case when p->>'source' in ('window', 'promise', 'catch') then p->>'source' else 'catch' end;
  v_ctx  jsonb := case when jsonb_typeof(p->'context') = 'object' and octet_length((p->'context')::text) <= 4000 then p->'context' end;
  v_bc   jsonb := '[]';
  v_role text;
  v_new  int;
begin
  if v_fp is null then return; end if;
  if not public.app_error_rate_ok('error', 20, 200) then return; end if;
  if jsonb_typeof(p->'breadcrumbs') = 'array' then
    select coalesce(jsonb_agg(e order by i), '[]') into v_bc
      from (select e, i from jsonb_array_elements(p->'breadcrumbs') with ordinality t(e, i) order by i desc limit 20) s;
    if octet_length(v_bc::text) > 4000 then v_bc := '[]'; end if;
  end if;
  -- only ids that exist in app_users (FK); a session of a deleted user counts as logged out
  select id into v_uid from public.app_users where id = (select auth.uid());
  if v_uid is not null then v_role := public.app_role(); end if;

  insert into public.app_errors as a (fingerprint, message, stack, source, where_, versions, last_version,
                                      last_user_id, last_role, last_device, last_breadcrumbs, last_context)
  values (v_fp, left(coalesce(p->>'message', ''), 1000), left(p->>'stack', 4096), v_src, left(p->>'where', 100),
          case when v_ver = '?' then '{}'::text[] else array[v_ver] end, v_ver, v_uid, v_role, left(p->>'device', 120), v_bc, v_ctx)
  on conflict (fingerprint) do update set
    count            = a.count + 1,
    last_seen        = now(),
    message          = excluded.message,
    stack            = coalesce(excluded.stack, a.stack),
    where_           = coalesce(excluded.where_, a.where_),
    last_version     = excluded.last_version,
    -- a version never seen on this row reopens a fixed bug; old cached clients (known versions) don't
    -- '?' = version not known yet (very early error): never reopens and is not listed
    status           = case when a.status = 'behoben' and v_ver <> '?' and not (v_ver = any (a.versions)) then 'neu' else a.status end,
    versions         = case when v_ver = '?' or v_ver = any (a.versions) then a.versions
                            else (a.versions || v_ver)[greatest(1, cardinality(a.versions) - 8):] end,
    last_user_id     = excluded.last_user_id,
    last_role        = excluded.last_role,
    last_device      = excluded.last_device,
    last_breadcrumbs = excluded.last_breadcrumbs,
    last_context     = excluded.last_context;

  if v_uid is not null then
    insert into public.app_error_users (fingerprint, user_id) values (v_fp, v_uid) on conflict do nothing;
    get diagnostics v_new = row_count;
    if v_new > 0 then update public.app_errors set users_affected = users_affected + 1 where fingerprint = v_fp; end if;
  end if;
end $$;

create or replace function public.report_problem(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_w   text := left(btrim(coalesce(p->>'wanted', '')), 2000);
  v_h   text := left(btrim(coalesce(p->>'happened', '')), 2000);
  v_ctx jsonb := case when jsonb_typeof(p->'context') = 'object' and octet_length((p->'context')::text) <= 8000 then p->'context' end;
  v_fps text[] := '{}';
  v_id  uuid;
begin
  if v_w = '' and v_h = '' then raise exception 'report_problem: empty report'; end if;
  if not public.app_error_rate_ok('report', 5, 30) then return null; end if;
  if jsonb_typeof(p->'fingerprints') = 'array' then
    select coalesce(array_agg(left(x, 64)), '{}') into v_fps
      from (select x from jsonb_array_elements_text(p->'fingerprints') x limit 20) s;
  end if;
  insert into public.bug_reports (user_id, role, wanted, happened, context, fingerprints)
  values (case when exists (select 1 from public.app_users where id = v_uid) then v_uid end,
          case when v_uid is not null then public.app_role() end, v_w, v_h, v_ctx, v_fps)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.log_error(jsonb), public.report_problem(jsonb) from public;
grant execute on function public.log_error(jsonb), public.report_problem(jsonb) to anon, authenticated, service_role;

-- 90 days retention (GDPR); the rate counter only needs the current hour
select cron.schedule('app-errors-cleanup', '20 3 * * *', $$
  delete from public.app_errors where last_seen < now() - interval '90 days';
  delete from public.bug_reports where created_at < now() - interval '90 days';
  delete from public.app_error_rate where hour < now() - interval '2 days';
$$);
