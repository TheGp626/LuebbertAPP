-- Undo migration absagen. Manual; every Absage is lost (the plan itself is not touched).
drop table if exists public.plan_cancellations;
drop function if exists public.plan_cancellations_decided();
