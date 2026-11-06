-- Rollback for 20261107_order_applications (applications and manual links are lost).
drop function if exists public.order_slots();
drop table if exists public.order_plan_links;
drop table if exists public.order_applications;
drop function if exists public.order_applications_decided();
