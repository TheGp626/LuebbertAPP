-- A Protokoll can carry the Auftrag (job number of the Auftragsbestätigung) it belongs to, so the dashboard can add up
-- people, hours and cost per Auftrag (Nachkalkulation). Additive: the column is optional and older app versions ignore it.
-- The phase is not stored: it follows from protocols.action (Aufbau/Teilaufbau, Abbau/Teilabbau).
-- No new policy: the existing rls_protocols_* policies cover the column.
-- Rollback: supabase/rollback/20261111_protokoll_auftrag_rollback.sql.

alter table public.protocols
  add column job_no text check (job_no ~ '^\d{2}-\d{4}\.\d{2}$');
create index protocols_job_no_idx on public.protocols (job_no) where job_no is not null;
