-- Rollback of 20261129_job_floorplans.sql. The PDFs under project-files/floorplans/ stay; delete them in the storage UI if wanted.
drop table if exists public.job_floorplans;
