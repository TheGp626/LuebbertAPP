-- Aufträge im Wochenplan: MA apply for a job phase (Aufbau/Abbau), PL/Admin accept; never written to plan_assignments,
-- so Daniel's re-import can't drop them. order_plan_links holds manual links to Daniel's entries (date + key, ids change on re-import).
-- order_slots() gives every non-guest the open phases without customer data (address, contacts, files).

create table public.order_applications (
  job_no text not null check (job_no ~ '^\d{2}-\d{4}\.\d{2}$'),
  phase text not null check (phase in ('setup', 'teardown')),
  user_id uuid not null references public.app_users(id) on delete cascade,
  status text not null default 'offen' check (status in ('offen', 'angenommen', 'abgelehnt')),
  created_at timestamptz not null default now(),
  decided_by uuid references public.app_users(id) on delete set null,
  decided_at timestamptz,
  primary key (job_no, phase, user_id)
);
alter table public.order_applications enable row level security;

create policy rls_order_applications_select on public.order_applications for select to authenticated
  using (user_id = (select auth.uid()) or (select public.app_role()) in ('Admin', 'PL'));
create policy rls_order_applications_insert on public.order_applications for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.app_role()) <> 'Gast' and status = 'offen');
create policy rls_order_applications_update on public.order_applications for update to authenticated
  using ((select public.app_role()) in ('Admin', 'PL'))
  with check ((select public.app_role()) in ('Admin', 'PL'));
create policy rls_order_applications_delete on public.order_applications for delete to authenticated
  using ((user_id = (select auth.uid()) and status = 'offen') or (select public.app_role()) in ('Admin', 'PL'));

grant select, insert, update, delete on public.order_applications to authenticated;

-- Who decided and when is set by the server, not the client
create function public.order_applications_decided() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  return new;
end $$;
create trigger order_applications_decided before update on public.order_applications
  for each row execute function public.order_applications_decided();

create table public.order_plan_links (
  job_no text not null check (job_no ~ '^\d{2}-\d{4}\.\d{2}$'),
  phase text not null check (phase in ('setup', 'teardown')),
  plan_date date,
  plan_key text,
  set_by uuid references public.app_users(id) on delete set null default auth.uid(),
  set_at timestamptz not null default now(),
  primary key (job_no, phase),
  check ((plan_date is null) = (plan_key is null)) -- both null = "do not link"
);
alter table public.order_plan_links enable row level security;

create policy rls_order_plan_links_select on public.order_plan_links for select to authenticated
  using ((select public.app_role()) <> 'Gast');
create policy rls_order_plan_links_insert on public.order_plan_links for insert to authenticated
  with check ((select public.app_role()) in ('Admin', 'PL'));
create policy rls_order_plan_links_update on public.order_plan_links for update to authenticated
  using ((select public.app_role()) in ('Admin', 'PL'))
  with check ((select public.app_role()) in ('Admin', 'PL'));
create policy rls_order_plan_links_delete on public.order_plan_links for delete to authenticated
  using ((select public.app_role()) in ('Admin', 'PL'));

grant select, insert, update, delete on public.order_plan_links to authenticated;

-- Open phases from today on: job from the newest parsed file per job number, needed > 0 in order_staffing
create function public.order_slots()
returns table (job_no text, phase text, name text, title text, room text, start_at text, end_at text,
  materials jsonb, notes text, needed int, accepted int, my_status text, link_date date, link_key text, link_set boolean)
language sql stable security definer set search_path = public as $$
  with jobs as (
    select distinct on (j->>'jobNo') j->>'jobNo' as jno, j as job, p.result->>'title' as ttl
    from public.order_parsed p
    join public.folder_files f on f.id = p.file_id
    cross join lateral jsonb_array_elements(coalesce(p.result->'jobs', '[]'::jsonb)) j
    where auth.uid() is not null and (select public.app_role()) <> 'Gast'
    order by j->>'jobNo', f.created_at desc
  ), ph as (
    select jb.jno, x.ph, jb.job, jb.ttl,
      (jb.job->x.ph)->>'start' as st, (jb.job->x.ph)->>'end' as en,
      case x.ph when 'setup' then s.staff_setup else s.staff_teardown end as nd
    from jobs jb
    join public.order_staffing s on s.job_no = jb.jno
    cross join (values ('setup'), ('teardown')) as x(ph)
  )
  select ph.jno, ph.ph, ph.job->>'name', ph.ttl, ph.job->>'room', ph.st, ph.en,
    coalesce(ph.job->'materials', '[]'::jsonb), ph.job->>'notes', ph.nd::int,
    (select count(*)::int from public.order_applications a where a.job_no = ph.jno and a.phase = ph.ph and a.status = 'angenommen'),
    (select a.status from public.order_applications a where a.job_no = ph.jno and a.phase = ph.ph and a.user_id = auth.uid()),
    l.plan_date, l.plan_key, l.job_no is not null
  from ph
  left join public.order_plan_links l on l.job_no = ph.jno and l.phase = ph.ph
  where ph.nd > 0 and ph.st ~ '^\d{4}-\d{2}-\d{2}' and left(ph.st, 10)::date >= current_date
  order by ph.st, ph.jno, ph.ph;
$$;
revoke all on function public.order_slots() from public, anon;
grant execute on function public.order_slots() to authenticated;
