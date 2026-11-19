-- Rollback of 20261119_abteilungs_mails. send-protocol-mail treats a missing log table as "skip department mails".
drop table if exists public.department_mail_log;
delete from public.app_settings where key in ('department_mail_enabled', 'department_mail_test_mode', 'department_routes');

do $$
declare def text := pg_get_functiondef('public.apply_app_settings(jsonb,uuid)'::regprocedure);
declare nd text;
begin
  nd := replace(def, ', ''department_mail_enabled'', ''department_mail_test_mode'')', ')');
  nd := regexp_replace(nd, 'elsif k = ''department_routes'' then.*?end if;\s*(elsif k = ''vehicle_rates'' then)', '\1', 's');
  if nd = def then raise exception 'apply_app_settings: nothing to roll back'; end if;
  execute nd;
end $$;
