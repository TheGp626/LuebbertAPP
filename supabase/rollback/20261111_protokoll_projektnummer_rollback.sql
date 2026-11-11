-- Undo migration protokoll_projektnummer. Manual; fails while a protocol carries a bare Projektnummer:
-- give those a job suffix (or null) first.
alter table public.protocols drop constraint protocols_job_no_check;
alter table public.protocols add constraint protocols_job_no_check check (job_no ~ '^\d{2}-\d{4}\.\d{2}$');
