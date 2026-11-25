-- Abteilungs-Adressen: the department mail addresses are no longer fixed in send-protocol-mail but the Admin setting
-- department_emails (department → address, '' = no mail). Two more departments, Logistik and Tischlerei, so their
-- areas can go to their own person. Only @peterluebbert.de addresses are accepted (here, in the app and again when sending).
-- Rollback: supabase/rollback/20261201_abteilungs_adressen_rollback.sql. Check: supabase/tests/abteilungs_adressen_check.sql.

insert into public.app_settings (key, value) values
  ('department_emails', '{"lager": "lager@peterluebbert.de", "logistik": "", "tischlerei": "", "stoffe": "Stoffe@peterluebbert.de", "floristik": "Florist@peterluebbert.de"}'::jsonb)
on conflict (key) do nothing;

alter table public.department_mail_log drop constraint department_mail_log_department_check;
alter table public.department_mail_log add constraint department_mail_log_department_check
  check (department in ('lager', 'logistik', 'tischlerei', 'stoffe', 'floristik'));

do $$
declare def text := pg_get_functiondef('public.apply_app_settings(jsonb,uuid)'::regprocedure);
declare nd text;
begin
  -- routes may point at the two new departments
  nd := replace(def, '(dep #>> ''{}'') not in ('''', ''lager'', ''stoffe'', ''floristik'')',
    '(dep #>> ''{}'') not in ('''', ''lager'', ''logistik'', ''tischlerei'', ''stoffe'', ''floristik'')');
  if nd = def then raise exception 'apply_app_settings: route list anchor not found'; end if;
  def := nd;
  nd := replace(def, 'elsif k = ''department_routes'' then',
    'elsif k = ''department_emails'' then
      if jsonb_typeof(v) <> ''object''
         or exists (select 1 from jsonb_each(v) e(dep, addr)
                    where dep not in (''lager'', ''logistik'', ''tischlerei'', ''stoffe'', ''floristik'')
                       or jsonb_typeof(addr) <> ''string''
                       or ((addr #>> ''{}'') <> '''' and (addr #>> ''{}'') !~* ''^[A-Za-z0-9._%+-]{1,64}@peterluebbert\.de$'')) then
        raise exception ''invalid_setting: %'', k;
      end if;
    elsif k = ''department_routes'' then');
  if nd = def then raise exception 'apply_app_settings: department_routes anchor not found'; end if;
  execute nd;
end $$;
