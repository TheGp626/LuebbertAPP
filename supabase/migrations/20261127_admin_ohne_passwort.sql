-- Admin-Seite (23.11.2026)
-- 1. Einstellungen speichern ohne Admin-Passwort: save_app_settings(changes) prüft nur die Rolle Admin (die Datenbank
--    kennt den Anrufer über den Login). set_app_settings(input_pin, …) bleibt für noch nicht aktualisierte Apps.
-- 2. Planer ("Plant den Wochenplan") dürfen eine Auftrags-Verknüpfung auch wieder löschen ("Automatisch"),
--    nicht nur anlegen und ändern.
-- Rollback: supabase/rollback/20261127_admin_ohne_passwort_rollback.sql. Prüfung: supabase/tests/admin_ohne_passwort_check.sql.

create or replace function public.save_app_settings(changes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if (select public.app_role()) is distinct from 'Admin' then
    raise exception 'forbidden';
  end if;
  return public.apply_app_settings(changes, (select auth.uid()));
end $$;
revoke execute on function public.save_app_settings(jsonb) from public, anon;
grant execute on function public.save_app_settings(jsonb) to authenticated, service_role;

drop policy if exists rls_order_plan_links_delete_planner on public.order_plan_links;
create policy rls_order_plan_links_delete_planner on public.order_plan_links
  for delete to authenticated using ((select public.plans_week()));
