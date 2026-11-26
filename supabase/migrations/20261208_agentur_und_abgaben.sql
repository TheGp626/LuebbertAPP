-- Agentursätze und Arbeitgeberabgaben (Jenni, Briefing 26.11.2026, Abschnitt 5):
-- 1. agency_rates: Zenjob / Rockit € per hour for Tag, Nacht, Sonntag, Feiertag (were fixed in the app and outdated).
-- 2. employer_charges: % Lübbert pays on top of Lohn Conni for Minijob (32,7) and Midijob (22); was a flat 25 %.
--    Satz intern of Minijob/Midijob people (app_users.hourly_rate_internal, role_rates[].rate_internal) follows it:
--    sync_internal_rates() recomputes them now and whenever the Admin changes employer_charges.
-- Rollback: supabase/rollback/20261208_agentur_und_abgaben_rollback.sql. Check: supabase/tests/agentur_und_abgaben_check.sql.

insert into public.app_settings (key, value) values
  ('agency_rates', '{"Zenjob":{"Tag":24.17,"Nacht":30.05,"Sonntag":35.92,"Feiertag":35.92},"Rockit":{"Tag":30,"Nacht":45,"Sonntag":45,"Feiertag":60}}'::jsonb),
  ('employer_charges', '{"Minijob":32.7,"Midijob":22}'::jsonb)
on conflict (key) do nothing;

-- Satz intern = Lohn Conni + Abgabe of the type, in cents (same as autoInternalRate in js/formulas.js).
-- Personal rate rows: "MA Minijob" uses its own type, old "MA frei" the person's type; rows without Lohn Conni stay.
create or replace function public.sync_internal_rates() returns void
language plpgsql security definer set search_path = public as $$
declare ch jsonb := coalesce((select value from public.app_settings where key = 'employer_charges'), '{}'::jsonb);
begin
  update public.app_users a set hourly_rate_internal = round(p.hourly_rate_conni * (100 + (ch ->> a.employment_type)::numeric)) / 100
    from public.app_user_private p
   where p.user_id = a.id and p.hourly_rate_conni > 0 and ch ? a.employment_type
     and a.hourly_rate_internal is distinct from round(p.hourly_rate_conni * (100 + (ch ->> a.employment_type)::numeric)) / 100;

  update public.app_users a set role_rates = (
      select jsonb_agg(case
        when t.typ is not null and ch ? t.typ and (r ->> 'rate_conni') ~ '^[0-9]+(\.[0-9]+)?$' and (r ->> 'rate_conni')::numeric > 0
          then jsonb_set(r, '{rate_internal}', to_jsonb(round((r ->> 'rate_conni')::numeric * (100 + (ch ->> t.typ)::numeric)) / 100))
        else r end order by o)
      from jsonb_array_elements(a.role_rates) with ordinality e(r, o)
      cross join lateral (select case
        when split_part(r ->> 'role', ' ', 2) in ('Minijob', 'Midijob', 'Rechnung', 'Fest') then split_part(r ->> 'role', ' ', 2)
        when split_part(r ->> 'role', ' ', 2) = 'frei' then a.employment_type end as typ) t)
   where jsonb_typeof(a.role_rates) = 'array' and jsonb_array_length(a.role_rates) > 0;
end $$;
revoke all on function public.sync_internal_rates() from public, anon, authenticated;

do $$
declare def text := pg_get_functiondef('public.apply_app_settings(jsonb,uuid)'::regprocedure);
declare nd text;
begin
  nd := replace(def, 'elsif k = ''department_routes'' then',
    'elsif k = ''agency_rates'' then
      if jsonb_typeof(v) <> ''object''
         or (select count(*) from jsonb_object_keys(v)) <> 2
         or exists (select 1 from unnest(array[''Zenjob'', ''Rockit'']) a
                    where jsonb_typeof(v -> a) is distinct from ''object''
                       or (select count(*) from jsonb_object_keys(v -> a)) <> 4
                       or exists (select 1 from unnest(array[''Tag'', ''Nacht'', ''Sonntag'', ''Feiertag'']) f
                                  where jsonb_typeof(v -> a -> f) is distinct from ''number''
                                     or (v -> a ->> f)::numeric not between 0 and 1000)) then
        raise exception ''invalid_setting: %'', k;
      end if;
    elsif k = ''employer_charges'' then
      if jsonb_typeof(v) <> ''object''
         or (select count(*) from jsonb_object_keys(v)) <> 2
         or exists (select 1 from unnest(array[''Minijob'', ''Midijob'']) t
                    where jsonb_typeof(v -> t) is distinct from ''number''
                       or (v ->> t)::numeric not between 0 and 100) then
        raise exception ''invalid_setting: %'', k;
      end if;
    elsif k = ''department_routes'' then');
  if nd = def then raise exception 'apply_app_settings: department_routes anchor not found'; end if;
  def := nd;
  nd := replace(def, '  return (select jsonb_object_agg(key, value) from public.app_settings);',
    '  if changes ? ''employer_charges'' then perform public.sync_internal_rates(); end if;
  return (select jsonb_object_agg(key, value) from public.app_settings);');
  if nd = def then raise exception 'apply_app_settings: return anchor not found'; end if;
  execute nd;
end $$;

select public.sync_internal_rates();
