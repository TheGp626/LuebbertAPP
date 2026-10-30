-- Automatic deletion of old project folders (NOT applied yet; the lead applies it after review).
-- All statements are idempotent (safe to run twice).
-- From now on project_folders.ends_on means "deletion date": cleanup-folders removes a top-level folder
-- (with subfolders and files) once the date has passed.

-- Log of deleted folders (written by the Edge Function with the service role)
create table if not exists public.folder_deletion_log (
  id uuid primary key default gen_random_uuid(),
  folder_name text not null,
  ends_on date,
  file_count int not null default 0,
  deleted_at timestamptz not null default now()
);
alter table public.folder_deletion_log enable row level security;
-- The app may read the log (admin view later); nobody but the service role writes it
drop policy if exists "folder_deletion_log anon select" on public.folder_deletion_log;
create policy "folder_deletion_log anon select" on public.folder_deletion_log for select to anon using (true);
grant select on public.folder_deletion_log to anon;

-- Admin switch (default on; the app and the function also default to on when the row is missing)
insert into public.app_settings (key, value)
select 'folder_autodelete_enabled', to_jsonb(true)
where not exists (select 1 from public.app_settings where key = 'folder_autodelete_enabled');

-- Existing top-level folders get a deletion date, but never earlier than 2026-11-06.
-- 1) jobs but no date: last non-cancelled job + 7 days
update public.project_folders f
set ends_on = greatest(sub.last_date + 7, date '2026-11-06')
from (select folder_id, max(date) last_date from public.einsaetze where not coalesce(cancelled, false) group by folder_id) sub
where sub.folder_id = f.id and f.parent_id is null and f.ends_on is null;
-- 2) date from the previous round (project end): keep it, but not before the grace date
update public.project_folders
set ends_on = date '2026-11-06'
where parent_id is null and ends_on is not null and ends_on < date '2026-11-06';

-- The settings RPC accepts only known keys: same function as before, plus folder_autodelete_enabled (boolean)
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
    else
      raise exception 'invalid_setting: %', k;
    end if;
  end loop;
  update public.app_settings s set value = c.value, updated_at = now(), updated_by = actor
    from jsonb_each(changes) c where s.key = c.key and s.value is distinct from c.value;
  return (select jsonb_object_agg(key, value) from public.app_settings);
end $function$;

-- Schedule (the lead runs this by hand after deploying the function; deliberately not part of the migration).
-- Daily 02:30 UTC, like the send-reminders-daily job; replace <PROJECT_REF> and <ANON_KEY>:
--
-- select cron.schedule('cleanup-folders-daily', '30 2 * * *', $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/cleanup-folders',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <ANON_KEY>'),
--     body := '{}'::jsonb
--   );
-- $$);
