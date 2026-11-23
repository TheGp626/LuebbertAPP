-- Rollback of 20261127_admin_ohne_passwort.sql (back to 20261126_app_errors). The app falls back to the password prompt.
drop policy if exists rls_order_plan_links_delete_planner on public.order_plan_links;
drop function if exists public.save_app_settings(jsonb);
