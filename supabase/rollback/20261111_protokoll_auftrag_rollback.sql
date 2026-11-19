-- Undo migration protokoll_auftrag. Manual; the job numbers stored on protocols are lost.
drop index if exists public.protocols_job_no_idx;
alter table public.protocols drop column if exists job_no;
