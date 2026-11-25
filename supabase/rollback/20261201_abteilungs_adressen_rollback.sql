-- Rollback of 20261201_abteilungs_adressen. Deploy the previous send-protocol-mail first (fixed addresses).
delete from public.app_settings where key = 'department_emails';
delete from public.department_mail_log where department in ('logistik', 'tischlerei');
update public.app_settings set value = (select jsonb_object_agg(area, case when dep #>> '{}' in ('logistik', 'tischlerei') then '""'::jsonb else dep end)
  from jsonb_each(value) e(area, dep)) where key = 'department_routes';
alter table public.department_mail_log drop constraint department_mail_log_department_check;
alter table public.department_mail_log add constraint department_mail_log_department_check
  check (department in ('lager', 'stoffe', 'floristik'));

do $$
declare def text := pg_get_functiondef('public.apply_app_settings(jsonb,uuid)'::regprocedure);
declare nd text;
begin
  nd := replace(def, ', ''logistik'', ''tischlerei'', ''stoffe'', ''floristik'')', ', ''stoffe'', ''floristik'')');
  nd := regexp_replace(nd, 'elsif k = ''department_emails'' then.*?end if;\s*(elsif k = ''department_routes'' then)', '\1', 's');
  if nd = def then raise exception 'apply_app_settings: nothing to roll back'; end if;
  execute nd;
end $$;
