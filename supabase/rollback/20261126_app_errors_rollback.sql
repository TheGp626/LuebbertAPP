-- Rollback of 20261126_app_errors.sql (back to 20261125_plan_inbox). Deletes all collected errors and reports.
select cron.unschedule('app-errors-cleanup');
drop function if exists public.log_error(jsonb);
drop function if exists public.report_problem(jsonb);
drop function if exists public.app_error_rate_ok(text, int, int);
drop table if exists public.app_error_users;
drop table if exists public.app_errors;
drop table if exists public.bug_reports;
drop table if exists public.app_error_rate;
