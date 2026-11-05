-- Employment type per person (Jenni 2026-11-05): replaces the "fest" checkbox. Shifts store
-- "<Funktion> <Typ>" (e.g. "MA Minijob") as a snapshot; per-type default rates live in app_settings.personnel_rates.
-- is_fest stays (old cached clients read it); the app keeps it in sync (is_fest = employment_type = 'Fest').
-- Rollback: supabase/rollback/20261105_beschaeftigungsart_rollback.sql

alter table public.app_users add column if not exists employment_type text not null default 'Minijob';
alter table public.app_users drop constraint if exists app_users_employment_type_check;
alter table public.app_users add constraint app_users_employment_type_check
  check (employment_type in ('Minijob', 'Midijob', 'Rechnung', 'Fest'));
update public.app_users set employment_type = 'Fest' where is_fest and employment_type <> 'Fest';

insert into public.app_settings (key, value) values ('personnel_rates',
  '{"Minijob":{"MA":21.5,"AL":25,"Fahrer":30},"Midijob":{"MA":21.5,"AL":25,"Fahrer":30},"Rechnung":{"MA":21.5,"AL":25,"Fahrer":30},"Fest":{"MA":0,"AL":0,"Fahrer":0}}'::jsonb)
on conflict (key) do nothing;

create or replace function public.apply_app_settings(changes jsonb, actor uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare k text; v jsonb; n numeric;
begin
  if changes is null or jsonb_typeof(changes) <> 'object' then
    raise exception 'invalid_setting: changes';
  end if;
  for k, v in select * from jsonb_each(changes) loop
    if k in ('reminders_enabled', 'plan_reminders_enabled', 'evening_push_enabled',
             'plan_change_push_enabled', 'protocol_mail_enabled', 'mail_test_mode', 'folder_push_enabled',
             'folder_autodelete_enabled') then
      if jsonb_typeof(v) <> 'boolean' then raise exception 'invalid_setting: %', k; end if;
    elsif k in ('evening_push_hour', 'billing_cutoff') then
      if jsonb_typeof(v) <> 'number' then raise exception 'invalid_setting: %', k; end if;
      n := v::text::numeric;
      if n <> trunc(n)
         or (k = 'evening_push_hour' and (n < 15 or n > 22))
         or (k = 'billing_cutoff' and (n < 1 or n > 31)) then
        raise exception 'invalid_setting: %', k;
      end if;
    elsif k = 'vehicle_rates' then
      if jsonb_typeof(v) <> 'object'
         or (select count(*) from jsonb_object_keys(v)) not between 1 and 50
         or exists (select 1 from jsonb_each(v) e(name, r)
                    where name <> btrim(name) or char_length(name) not between 1 and 40
                       or jsonb_typeof(r) <> 'object'
                       or (select count(*) from jsonb_object_keys(r)) <> 3
                       or exists (select 1 from unnest(array['wk', 'sa', 'so']) f
                                  where jsonb_typeof(r -> f) is distinct from 'number'
                                     or (r ->> f)::numeric not between 0 and 100000)) then
        raise exception 'invalid_setting: %', k;
      end if;
    elsif k = 'personnel_rates' then
      if jsonb_typeof(v) <> 'object'
         or (select count(*) from jsonb_object_keys(v)) <> 4
         or exists (select 1 from unnest(array['Minijob', 'Midijob', 'Rechnung', 'Fest']) t
                    where jsonb_typeof(v -> t) is distinct from 'object'
                       or (select count(*) from jsonb_object_keys(v -> t)) <> 3
                       or exists (select 1 from unnest(array['MA', 'AL', 'Fahrer']) f
                                  where jsonb_typeof(v -> t -> f) is distinct from 'number'
                                     or (v -> t ->> f)::numeric not between 0 and 1000)) then
        raise exception 'invalid_setting: %', k;
      end if;
    else
      raise exception 'invalid_setting: %', k;
    end if;
  end loop;
  update public.app_settings s set value = c.value, updated_at = now(), updated_by = actor
    from jsonb_each(changes) c where s.key = c.key and s.value is distinct from c.value;
  return (select jsonb_object_agg(key, value) from public.app_settings);
end $function$;
