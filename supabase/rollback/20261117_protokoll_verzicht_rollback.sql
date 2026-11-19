-- Rollback of 20261117_protokoll_verzicht. The app reads the table only best effort: without it nothing counts as marked.
drop table if exists public.protocol_waivers;
