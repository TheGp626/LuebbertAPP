-- Jenni round 2 (applied to production 2026-10-30 as migration jenni_runde_2).
-- All statements are additive and idempotent (safe to run twice, old rows are untouched).

-- Driver hours of a transport (null = row saved before this existed -> no driver cost)
alter table public.protocol_transports add column if not exists driver_hours numeric null;
-- Registered driver (rate lookup); null = free-text name
alter table public.protocol_transports add column if not exists driver_user_id uuid null references public.app_users(id);

-- Project end date (Task 7) and the ALs already pushed for a folder (notify-folder, Task 6)
alter table public.project_folders add column if not exists ends_on date null;
alter table public.project_folders add column if not exists notified_al_ids uuid[] not null default '{}';

-- Admin switch for the folder push (default on; the app and the function also default to on when the row is missing)
insert into public.app_settings (key, value)
select 'folder_push_enabled', to_jsonb(true)
where not exists (select 1 from public.app_settings where key = 'folder_push_enabled');

-- Existing folders: their current ALs count as already told, so the first edit after this migration
-- doesn't push "Neuer Projektordner" for old (often past) jobs
update public.project_folders f set notified_al_ids = sub.ids
from (select folder_id, array_agg(distinct al_id) ids from public.einsaetze where al_id is not null group by folder_id) sub
where sub.folder_id = f.id and f.notified_al_ids = '{}';

-- The settings RPC accepts only known keys: same function as before, plus folder_push_enabled (boolean)
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
             'plan_change_push_enabled', 'protocol_mail_enabled', 'mail_test_mode', 'folder_push_enabled') then
      if jsonb_typeof(v) <> 'boolean' then raise exception 'invalid_setting: %', k; end if;
    elsif k in ('evening_push_hour', 'billing_cutoff') then
      if jsonb_typeof(v) <> 'number' then raise exception 'invalid_setting: %', k; end if;
      n := v::text::numeric;
      if n <> trunc(n)
         or (k = 'evening_push_hour' and (n < 15 or n > 22))
         or (k = 'billing_cutoff' and (n < 1 or n > 31)) then
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
