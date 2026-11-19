-- protocols.job_no also takes the bare Projektnummer of the Auftragsbestätigung ("26-0447"), not only a job of it
-- ("26-0447.01"): an AL who types the number by hand knows the project, not always which job. The Nachkalkulation
-- adds up per Projektnummer either way. Rollback: supabase/rollback/20261111_protokoll_projektnummer_rollback.sql.
alter table public.protocols drop constraint protocols_job_no_check;
alter table public.protocols add constraint protocols_job_no_check check (job_no ~ '^\d{2}-\d{4}(\.\d{2})?$');
