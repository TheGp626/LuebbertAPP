-- Rollback of 20261109_einsatz_auftrag.sql: order_slots() as in 20261107_order_applications.sql, then the tag columns go
-- (which Einsatz belongs to which Auftrag phase is lost; the Einsätze themselves stay).

create or replace function public.order_slots()
returns table (job_no text, phase text, name text, title text, room text, start_at text, end_at text,
  materials jsonb, notes text, needed int, accepted int, accepted_ids uuid[], my_status text, link_date date, link_key text, link_set boolean)
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
    (select coalesce(array_agg(a.user_id), '{}') from public.order_applications a where a.job_no = ph.jno and a.phase = ph.ph and a.status = 'angenommen'),
    (select a.status from public.order_applications a where a.job_no = ph.jno and a.phase = ph.ph and a.user_id = auth.uid()),
    l.plan_date, l.plan_key, l.job_no is not null
  from ph
  left join public.order_plan_links l on l.job_no = ph.jno and l.phase = ph.ph
  -- ISO text compares like a date; no cast, so one malformed parse can't break the RPC for everyone
  where ph.nd > 0 and ph.st ~ '^\d{4}-\d{2}-\d{2}' and left(ph.st, 10) >= to_char(current_date, 'YYYY-MM-DD')
  order by ph.st, ph.jno, ph.ph;
$$;

alter table public.einsaetze drop column job_no, drop column phase;
