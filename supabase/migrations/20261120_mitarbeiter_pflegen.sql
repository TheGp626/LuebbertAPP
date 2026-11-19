-- Mitarbeiter pflegen, Verdienstgrenzen und unter 18 (Spec of 18.11.2026, Teil A to F).
-- A: app_users.keep_until ("Behalten" on the list „Lange kein Einsatz“), setting inactive_months.
-- B: worker_name_aliases (free-text name from the protocol → person; user_id null = Fremdkraft),
--    assign_worker_name / unassign_worker_name (Admin) set or clear shifts.user_id and keep the free text.
-- C: settings income_limit_minijob / income_limit_midijob (default limit per Art der Anstellung).
-- D: private bucket avatars (<user id>.jpg), app_users.photo_path / photo_consent_at, set_my_photo, clear_photo, team_photos.
-- E: staff_minors (a row = Haken „unter 18“, no birth date; Admin and Buchhaltung read, Admin writes),
--    i_am_minor() for the person, minors_among() for whoever decides Meldungen.
-- F: income_shares(): share of the limit and hours per person, no euros (Admin and „Sieht Bewerbungen“).
-- Rollback: supabase/rollback/20261120_mitarbeiter_pflegen_rollback.sql. Check: supabase/tests/mitarbeiter_pflegen_check.sql.

-- ── Settings (A, C) ──
insert into public.app_settings (key, value) values
  ('income_limit_minijob', '603'::jsonb),
  ('income_limit_midijob', '2000'::jsonb),
  ('inactive_months', '3'::jsonb)
on conflict (key) do nothing;

do $$
declare def text := pg_get_functiondef('public.apply_app_settings(jsonb,uuid)'::regprocedure);
declare nd text;
begin
  nd := replace(def, 'elsif k = ''department_routes'' then',
    'elsif k in (''income_limit_minijob'', ''income_limit_midijob'', ''inactive_months'') then
      if jsonb_typeof(v) <> ''number'' then raise exception ''invalid_setting: %'', k; end if;
      n := v::text::numeric;
      if (k = ''inactive_months'' and (n <> trunc(n) or n < 1 or n > 24))
         or (k <> ''inactive_months'' and (n < 0 or n > 100000)) then
        raise exception ''invalid_setting: %'', k;
      end if;
    elsif k = ''department_routes'' then');
  if nd = def then raise exception 'apply_app_settings: department_routes anchor not found'; end if;
  execute nd;
end $$;

-- ── Columns on app_users (A, D) ──
alter table public.app_users
  add column if not exists keep_until date,
  add column if not exists photo_path text,
  add column if not exists photo_consent_at timestamptz;

-- ── B: remembered spellings ──
create table public.worker_name_aliases (
  alias text primary key check (alias = lower(btrim(alias)) and char_length(alias) between 1 and 80),
  user_id uuid references public.app_users(id) on delete cascade,  -- null = Fremdkraft, stays free text
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.worker_name_aliases enable row level security;
revoke all on public.worker_name_aliases from public, anon, authenticated;
grant select, insert, update, delete on public.worker_name_aliases to authenticated;
grant all on public.worker_name_aliases to service_role;
create policy rls_worker_name_aliases_select on public.worker_name_aliases for select to authenticated
  using ((select public.app_role()) in ('AL', 'PL', 'Admin'));
create policy rls_worker_name_aliases_insert on public.worker_name_aliases for insert to authenticated
  with check ((select public.app_role()) = 'Admin');
create policy rls_worker_name_aliases_update on public.worker_name_aliases for update to authenticated
  using ((select public.app_role()) = 'Admin') with check ((select public.app_role()) = 'Admin');
create policy rls_worker_name_aliases_delete on public.worker_name_aliases for delete to authenticated
  using ((select public.app_role()) = 'Admin');

-- Every free-text shift with exactly this name (not Zenjob/Rockit) goes to the person; the free text stays for undo.
create or replace function public.assign_worker_name(p_name text, p_user uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare k text := lower(btrim(coalesce(p_name, ''))); n integer;
begin
  if (select public.app_role()) <> 'Admin' then raise exception 'not allowed' using errcode = 'insufficient_privilege'; end if;
  if k = '' or char_length(k) > 80 then raise exception 'invalid name' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.app_users where id = p_user and is_active is not false) then
    raise exception 'unknown person' using errcode = 'foreign_key_violation';
  end if;
  update public.shifts set user_id = p_user
   where user_id is null and lower(btrim(temp_worker_name)) = k
     and coalesce(position_role, '') not in ('Zenjob', 'Rockit');
  get diagnostics n = row_count;
  insert into public.worker_name_aliases (alias, user_id) values (k, p_user)
    on conflict (alias) do update set user_id = excluded.user_id, created_by = auth.uid(), created_at = now();
  return n;
end $$;

-- Undo: the shifts of this person that still carry the name become free text again; the spelling is forgotten
create or replace function public.unassign_worker_name(p_name text, p_user uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare k text := lower(btrim(coalesce(p_name, ''))); n integer;
begin
  if (select public.app_role()) <> 'Admin' then raise exception 'not allowed' using errcode = 'insufficient_privilege'; end if;
  update public.shifts set user_id = null
   where user_id = p_user and lower(btrim(temp_worker_name)) = k;
  get diagnostics n = row_count;
  delete from public.worker_name_aliases where alias = k and user_id = p_user;
  return n;
end $$;

revoke all on function public.assign_worker_name(text, uuid) from public, anon;
revoke all on function public.unassign_worker_name(text, uuid) from public, anon;
grant execute on function public.assign_worker_name(text, uuid) to authenticated;
grant execute on function public.unassign_worker_name(text, uuid) to authenticated;

-- ── E: Haken „unter 18“ ──
create table public.staff_minors (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  set_by uuid default auth.uid(),
  set_at timestamptz not null default now()
);
alter table public.staff_minors enable row level security;
revoke all on public.staff_minors from public, anon, authenticated;
grant select, insert, delete on public.staff_minors to authenticated;
grant all on public.staff_minors to service_role;
create policy rls_staff_minors_select on public.staff_minors for select to authenticated
  using ((select public.app_role()) in ('Buchhaltung', 'Admin'));
create policy rls_staff_minors_insert on public.staff_minors for insert to authenticated
  with check ((select public.app_role()) = 'Admin');
create policy rls_staff_minors_delete on public.staff_minors for delete to authenticated
  using ((select public.app_role()) = 'Admin');

-- The person itself: hides „Ich kann“ on night work
create or replace function public.i_am_minor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_minors where user_id = (select auth.uid()));
$$;

-- Whoever decides Meldungen learns it only for the people asked about (and only to lock Annehmen)
create or replace function public.minors_among(p_ids uuid[])
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.user_id from public.staff_minors m
   where m.user_id = any (coalesce(p_ids, '{}')) and (select public.sees_plan_interest());
$$;

revoke all on function public.i_am_minor() from public, anon;
revoke all on function public.minors_among(uuid[]) from public, anon;
grant execute on function public.i_am_minor() to authenticated;
grant execute on function public.minors_among(uuid[]) to authenticated;

-- ── D: Profilbild ──
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false) on conflict (id) do nothing;

create policy rls_avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (select public.app_role()) <> 'Gast');
create policy rls_avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (select public.app_role()) <> 'Gast'
    and (name = (select auth.uid())::text || '.jpg' or (select public.app_role()) = 'Admin'));
create policy rls_avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (name = (select auth.uid())::text || '.jpg' or (select public.app_role()) = 'Admin'))
  with check (bucket_id = 'avatars' and (name = (select auth.uid())::text || '.jpg' or (select public.app_role()) = 'Admin'));
create policy rls_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (name = (select auth.uid())::text || '.jpg' or (select public.app_role()) = 'Admin'));

-- Own photo on or off (an MA may not update app_users itself). The consent time is kept from the first upload.
create or replace function public.set_my_photo(p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select public.app_role()) = 'Gast' then raise exception 'not allowed' using errcode = 'insufficient_privilege'; end if;
  update public.app_users
     set photo_path = case when p_on then id::text || '.jpg' else null end,
         photo_consent_at = case when p_on then coalesce(photo_consent_at, now()) else null end
   where id = (select auth.uid());
end $$;

create or replace function public.clear_photo(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select public.app_role()) <> 'Admin' then raise exception 'not allowed' using errcode = 'insufficient_privilege'; end if;
  update public.app_users set photo_path = null, photo_consent_at = null where id = p_user;
end $$;

-- Who has a photo (MA may not read other app_users rows); never for Gast
create or replace function public.team_photos()
returns table (user_id uuid, photo_path text) language sql stable security definer set search_path = public as $$
  select id, photo_path from public.app_users
   where photo_path is not null and is_active is not false and (select public.app_role()) <> 'Gast';
$$;

revoke all on function public.set_my_photo(boolean) from public, anon;
revoke all on function public.clear_photo(uuid) from public, anon;
revoke all on function public.team_photos() from public, anon;
grant execute on function public.set_my_photo(boolean) to authenticated;
grant execute on function public.clear_photo(uuid) to authenticated;
grant execute on function public.team_photos() to authenticated;

-- ── F: share of the limit, without euros ──
-- Hours as in the Office Dashboard: net minutes (overnight, pause off), at least 3 h per shift. Pay = hours × own rate.
-- Limit: own one, else by Art der Anstellung from the settings (Rechnung/Fest: none). p_from..p_to = current billing
-- month, p_year_from..p_from-1 = the billing months before it this year (p_past_months of them).
create or replace function public.income_shares(p_ids uuid[], p_from date, p_to date, p_year_from date, p_past_months integer)
returns table (user_id uuid, pct integer, hours numeric, ahead integer, has_limit boolean, has_rate boolean)
language sql stable security definer set search_path = public as $$
  with s as (
    select sh.user_id, coalesce(sh.shift_date, p.date, sh.created_at::date) as d,
      greatest(180, (extract(epoch from (sh.end_time - sh.start_time)) / 60)::int
        + case when sh.end_time < sh.start_time then 1440 else 0 end - coalesce(sh.pause_mins, 0)) as mins
    from public.shifts sh left join public.protocols p on p.id = sh.protocol_id
    where sh.user_id = any (coalesce(p_ids, '{}')) and sh.start_time is not null and sh.end_time is not null
  ), cfg as (
    select (select (value #>> '{}')::numeric from public.app_settings where key = 'income_limit_minijob') as mini,
           (select (value #>> '{}')::numeric from public.app_settings where key = 'income_limit_midijob') as midi
  ), u as (
    select a.id, nullif(pr.hourly_rate_conni, 0) as rate,
      coalesce(nullif(pr.income_limit, 0),
        case coalesce(a.employment_type, case when a.is_fest then 'Fest' else 'Minijob' end)
          when 'Minijob' then cfg.mini when 'Midijob' then cfg.midi end) as lim
    from public.app_users a cross join cfg left join public.app_user_private pr on pr.user_id = a.id
    where a.id = any (coalesce(p_ids, '{}'))
  ), t as (
    select u.id, u.rate, u.lim,
      coalesce(sum(s.mins) filter (where s.d between p_from and p_to), 0) as cur_mins,
      coalesce(sum(s.mins) filter (where s.d >= p_year_from and s.d < p_from), 0) as past_mins
    from u left join s on s.user_id = u.id group by u.id, u.rate, u.lim
  )
  select t.id,
    case when t.rate is null or not t.lim > 0 then null else round(t.cur_mins / 60.0 * t.rate / t.lim * 100)::int end,
    round(t.cur_mins / 60.0, 1),
    case when t.rate is null or not t.lim > 0 then 0
      else greatest(0, floor((t.past_mins / 60.0 * t.rate - t.lim * greatest(p_past_months, 0)) / t.lim))::int end,
    t.lim > 0, t.rate is not null
  from t
  where (select public.sees_plan_interest());
$$;
revoke all on function public.income_shares(uuid[], date, date, date, integer) from public, anon;
grant execute on function public.income_shares(uuid[], date, date, date, integer) to authenticated;
