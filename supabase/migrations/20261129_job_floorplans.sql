-- Raumpläne am Auftrag (Testversion, 23.11.2026): ein eingelesener Plan (js/planlesen.js) gehört zu einem Auftrag.
-- Die PDF liegt privat im Bucket project-files unter floorplans/, hier stehen Titel, Raum, Zeitraum und das Ergebnis
-- (benannte Symbolgruppen mit ihren Positionen) für den Plan-Viewer im Wochenplan und auf "Heute".
-- Lesen: alle mit Konto außer Gast (die Crew sieht den Plan am Einsatz). Schreiben: PL und Admin
-- (wie das Hochladen in project-files). Rollback: supabase/rollback/20261129_job_floorplans_rollback.sql.
-- Prüfung: supabase/tests/job_floorplans_check.sql.
create table if not exists public.job_floorplans (
  id         uuid primary key default gen_random_uuid(),
  job_no     text check (job_no is null or job_no ~ '^\d{2}-\d{4}(\.\d{2})?$'),
  title      text not null check (char_length(title) between 1 and 160),
  room       text not null default '' check (char_length(room) <= 120),
  date_from  date,
  date_to    date check (date_to is null or date_from is null or date_to >= date_from),
  file_path  text not null check (file_path like 'floorplans/%' and char_length(file_path) <= 300),
  page       int not null default 1 check (page between 1 and 200),
  result     jsonb not null default '{}'::jsonb check (octet_length(result::text) <= 400000),
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_floorplans_job_no on public.job_floorplans (job_no);
create index if not exists job_floorplans_dates on public.job_floorplans (date_from, date_to);
alter table public.job_floorplans enable row level security;
revoke all on public.job_floorplans from anon;
grant select, insert, update, delete on public.job_floorplans to authenticated;

drop policy if exists rls_job_floorplans_select on public.job_floorplans;
create policy rls_job_floorplans_select on public.job_floorplans for select to authenticated
  using ((select public.app_role()) <> 'Gast');
drop policy if exists rls_job_floorplans_insert on public.job_floorplans;
create policy rls_job_floorplans_insert on public.job_floorplans for insert to authenticated
  with check ((select public.app_role()) in ('PL', 'Admin'));
drop policy if exists rls_job_floorplans_update on public.job_floorplans;
create policy rls_job_floorplans_update on public.job_floorplans for update to authenticated
  using ((select public.app_role()) in ('PL', 'Admin')) with check ((select public.app_role()) in ('PL', 'Admin'));
drop policy if exists rls_job_floorplans_delete on public.job_floorplans;
create policy rls_job_floorplans_delete on public.job_floorplans for delete to authenticated
  using ((select public.app_role()) in ('PL', 'Admin'));
