-- Rollback of 20261208_agentur_und_abgaben. Satz intern values stay as last computed (the old app recomputes
-- Lohn Conni + 25 % the next time a person is saved).
delete from public.app_settings where key in ('agency_rates', 'employer_charges');

do $$
declare def text := pg_get_functiondef('public.apply_app_settings(jsonb,uuid)'::regprocedure);
declare nd text;
begin
  nd := regexp_replace(def, 'elsif k = ''agency_rates'' then.*?end if;\s*elsif k = ''employer_charges'' then.*?end if;\s*(elsif k = ''department_routes'' then)', '\1', 's');
  nd := replace(nd, '  if changes ? ''employer_charges'' then perform public.sync_internal_rates(); end if;
', '');
  if nd = def then raise exception 'apply_app_settings: nothing to roll back'; end if;
  execute nd;
end $$;

drop function if exists public.sync_internal_rates();
