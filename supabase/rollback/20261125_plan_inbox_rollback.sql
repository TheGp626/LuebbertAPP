-- Undo migration plan_inbox. Manual; the stored mail PDFs and the inbox list are lost (imported plans are not touched).
-- Also: select cron.unschedule('poll-plan-inbox'); and delete the bucket plan-inbox in the Storage UI (SQL can't drop a non-empty bucket).
drop policy if exists rls_objects_plan_inbox_select on storage.objects;
drop table if exists public.plan_inbox;
