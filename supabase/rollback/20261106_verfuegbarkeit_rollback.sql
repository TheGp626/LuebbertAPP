-- Undo migration verfuegbarkeit. Manual; drops every blocked day (export public.availability first if needed).
do $$
declare def text := pg_get_functiondef('public.apply_app_settings(jsonb,uuid)'::regprocedure);
declare nd text := replace(def, ', ''availability_for_all'')', ')');
begin
  if nd <> def then execute nd; end if;
end $$;
drop function if exists public.availability_people();
drop table if exists public.availability;
alter table public.app_users drop column if exists availability_enabled;
delete from public.app_settings where key = 'availability_for_all';
