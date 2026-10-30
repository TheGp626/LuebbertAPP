-- Jenni round 2. NOT applied by the app; run once by hand in the Supabase SQL editor.
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

-- NOTE: saving settings in the app goes through the RPC set_app_settings, whose definition is not in this repo.
-- If it validates keys against a fixed list, add 'folder_push_enabled' (boolean) there, or the admin switch
-- cannot be saved ("invalid_setting: folder_push_enabled").
