-- Material abhaken (Spec "Mengen abhaken und Abteilungs-Mails", Teil A): AL, PL and the MA planned on an Einsatz tick off
-- the positions of the Auftragsbestätigung (or the material lines of the Wochenplan) with the real quantity, once at
-- Aufbau and once at Abbau. One row per list + phase + position; a position without a row is still open.
--   list_key  'job:26-1234.01' (Auftragsbestätigung) or 'plan:2026-11-18|breko' (Wochenplan: date | planEventKey)
--   plan_keys plan_shifts.key of the Einsatz the row was written from: an MA sees and writes only lists of their own
--             Einsätze from the day before to the day after (order_check_mine)
--   changed_at when the phone made the change (offline changes arrive later): the later change wins
-- Also: order_check_items() gives AL and planned MA quantity + name of one job's positions (not the whole
-- Auftragsbestätigung), protocols.shortages keeps the confirmed "Fehlmengen laut Auftrag", and Realtime is switched on
-- for order_checks, protocols and shifts (the Dashboard already subscribes to the latter two).
-- Rollback: supabase/rollback/20261119_material_abhaken_rollback.sql. Check: supabase/tests/material_abhaken_check.sql.

create table public.order_checks (
  list_key text not null check (list_key ~ '^(job:[0-9]{2}-[0-9]{4}\.[0-9]{2}|plan:[0-9]{4}-[0-9]{2}-[0-9]{2}\|.{1,200})$'),
  phase text not null check (phase in ('aufbau', 'abbau')),
  item_key text not null check (char_length(item_key) between 1 and 200),
  item_name text not null default '' check (char_length(item_name) <= 300),
  soll numeric check (soll >= 0 and soll < 100000),
  qty numeric not null check (qty >= 0 and qty < 100000),
  note text not null default '' check (char_length(note) <= 500),
  plan_date date not null,
  plan_keys text[] not null default '{}' check (cardinality(plan_keys) <= 50),
  changed_at timestamptz not null default now(),
  updated_by uuid references public.app_users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (list_key, phase, item_key)
);
create index order_checks_updated_by_idx on public.order_checks (updated_by);
create index order_checks_plan_date_idx on public.order_checks (plan_date);

-- Server time for updated_at/updated_by; a change made earlier than the stored one (offline phone) does not overwrite it
create function public.order_checks_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.changed_at := least(coalesce(new.changed_at, now()), now() + interval '1 minute');
  if tg_op = 'UPDATE' then
    if new.changed_at < old.changed_at then return old; end if;
    new.plan_keys := array(select distinct k from unnest(old.plan_keys || new.plan_keys) k);
  end if;
  return new;
end $$;
revoke execute on function public.order_checks_stamp() from public, anon, authenticated;
create trigger order_checks_stamp before insert or update on public.order_checks
  for each row execute function public.order_checks_stamp();

-- Is the caller planned on this list's Einsatz (yesterday, today or tomorrow)? Job lists also through order_plan_links.
create function public.order_check_mine(p_list text, p_keys text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.plan_assignments pa join public.plan_shifts ps on ps.id = pa.shift_id
    where pa.user_id = (select auth.uid())
      and ps.date between current_date - 1 and current_date + 1
      and (ps.key = any(coalesce(p_keys, '{}'))
           or (p_list like 'job:%' and exists (select 1 from public.order_plan_links l
                where l.job_no = substr(p_list, 5) and l.plan_key = ps.key and l.plan_date = ps.date))))
$$;
revoke execute on function public.order_check_mine(text, text[]) from public, anon;
grant execute on function public.order_check_mine(text, text[]) to authenticated, service_role;

alter table public.order_checks enable row level security;
revoke all on public.order_checks from public, anon;
grant select, insert, update, delete on public.order_checks to authenticated;
grant all on public.order_checks to service_role;

create policy rls_order_checks_select on public.order_checks for select to authenticated
  using ((select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin')
         or ((select public.app_role()) = 'MA' and public.order_check_mine(list_key, plan_keys)));
create policy rls_order_checks_insert on public.order_checks for insert to authenticated
  with check (updated_by = (select auth.uid()) and ((select public.app_role()) in ('AL', 'PL', 'Admin')
         or ((select public.app_role()) = 'MA' and public.order_check_mine(list_key, plan_keys))));
create policy rls_order_checks_update on public.order_checks for update to authenticated
  using ((select public.app_role()) in ('AL', 'PL', 'Admin')
         or ((select public.app_role()) = 'MA' and public.order_check_mine(list_key, plan_keys)))
  with check (updated_by = (select auth.uid()) and ((select public.app_role()) in ('AL', 'PL', 'Admin')
         or ((select public.app_role()) = 'MA' and public.order_check_mine(list_key, plan_keys))));
-- Starting a list over: PL/Admin only
create policy rls_order_checks_delete on public.order_checks for delete to authenticated
  using ((select public.app_role()) in ('PL', 'Admin'));

-- Positions (quantity + name only) of one job from the newest Auftragsbestätigung read in the app.
-- order_parsed stays PL/Admin; this is the narrow view for everyone who may tick off that job.
create function public.order_check_items(p_job text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; role text := public.app_role();
begin
  if p_job is null or p_job !~ '^[0-9]{2}-[0-9]{4}\.[0-9]{2}$' then return null; end if;
  if not (role in ('AL', 'PL', 'Buchhaltung', 'Admin') or (role = 'MA' and public.order_check_mine('job:' || p_job, '{}'))) then
    raise exception 'not_allowed' using errcode = 'insufficient_privilege';
  end if;
  select jsonb_build_object(
      'jobNo', j ->> 'jobNo',
      'name', coalesce(j ->> 'name', ''),
      'parsedAt', op.parsed_at,
      'materials', coalesce((select jsonb_agg(jsonb_build_object('group', coalesce(g ->> 'group', ''),
          'items', coalesce((select jsonb_agg(jsonb_build_object('qty', it -> 'qty', 'name', it ->> 'name'))
                             from jsonb_array_elements(case when jsonb_typeof(g -> 'items') = 'array' then g -> 'items' else '[]'::jsonb end) it), '[]'::jsonb)))
        from jsonb_array_elements(case when jsonb_typeof(j -> 'materials') = 'array' then j -> 'materials' else '[]'::jsonb end) g), '[]'::jsonb))
    into r
    from public.order_parsed op
    join public.folder_files f on f.id = op.file_id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(op.result -> 'jobs') = 'array' then op.result -> 'jobs' else '[]'::jsonb end) j
    where j ->> 'jobNo' = p_job
    order by f.created_at desc, op.parsed_at desc
    limit 1;
  return r;
end $$;
revoke execute on function public.order_check_items(text) from public, anon;
grant execute on function public.order_check_items(text) to authenticated, service_role;

-- "Fehlmengen laut Auftrag" as confirmed by the AL when saving the protocol: [{name, soll, ist, fehlt, note}]
alter table public.protocols add column shortages jsonb
  check (shortages is null or (jsonb_typeof(shortages) = 'array' and jsonb_array_length(shortages) <= 500));

-- Realtime: live ticks for order_checks; protocols and shifts for the Dashboard (RLS applies to every subscriber)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.order_checks, public.protocols, public.shifts;
