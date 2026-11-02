-- Lübbert App: database schema (public schema), read from the live project on 2026-11-02.
-- Regenerate from the catalog (pg_attribute, pg_constraint, pg_policies, pg_get_functiondef) after schema changes;
-- the files in supabase/migrations/ are the individual changes since 2026-10-30.
--
-- Left out on purpose:
--   * the admin PIN (verify_admin_pin holds it in plain text) → placeholder <ADMIN_PIN>
--   * the anon key in the cron jobs → placeholder <ANON_KEY>
--   * old policies "to authenticated" (Admins and leads can manage …, Users can read all profiles, …):
--     the app never signs in to Supabase Auth, every request runs as anon, so they never apply
--   * Supabase's own event triggers and default grants for service_role / authenticated
--
-- Security model: the browser only uses the anon key and every table allows anon everything it needs.
-- Roles are enforced in the client only. See README "sicherheit".

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ══════════════ TABLES ══════════════
-- Foreign keys follow at the end, so the tables can be created in any order.

create table public.app_users (
  id uuid default gen_random_uuid() not null primary key,
  email text,
  full_name text,
  role text default 'MA'::text,
  default_dept text default 'MA für Auf-/ Abbau'::text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  hourly_rate_conni numeric(10,2),
  hourly_rate_internal numeric(10,2),
  income_limit numeric,
  role_rates jsonb default '[]'::jsonb,
  is_active boolean default true,
  is_fest boolean default false,
  calendar_token uuid default gen_random_uuid() not null,
  constraint app_users_role_check CHECK (role = ANY (ARRAY['AL','MA','PL','Buchhaltung','Admin','Gast']))
);

create table public.app_settings (
  key text not null primary key,
  value jsonb not null,
  updated_at timestamp with time zone default now() not null,
  updated_by uuid
);
create index app_settings_updated_by_idx on public.app_settings using btree (updated_by);

create table public.projects (
  id uuid default uuid_generate_v4() not null primary key,
  name text not null,
  location text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.protocols (
  id uuid default uuid_generate_v4() not null primary key,
  project_id uuid,
  date date not null,
  action text default 'Aufbau'::text,
  is_holiday boolean default false,
  al_id uuid,
  pl_id uuid,
  al_name_fallback text,
  pl_name_fallback text,
  signature_text text,
  total_cost numeric,
  notes_damages text,
  notes_incidents text,
  notes_feedback text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  mailed_at timestamp with time zone,
  created_by uuid
);
create index idx_protocols_al_id on public.protocols using btree (al_id);
create index idx_protocols_pl_id on public.protocols using btree (pl_id);
create index idx_protocols_project_id on public.protocols using btree (project_id);

create table public.protocol_transports (
  id uuid default uuid_generate_v4() not null primary key,
  protocol_id uuid not null,
  vehicle_type text not null,
  driver_name text,
  punctuality text,
  delay_mins integer,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  driver_hours numeric,      -- null = row from before driver hours existed → no driver cost
  driver_user_id uuid
);
create index idx_transports_protocol_id on public.protocol_transports using btree (protocol_id);

create table public.protocol_equipments (
  id uuid default uuid_generate_v4() not null primary key,
  protocol_id uuid not null,
  category_id text not null,
  status text not null,
  note text,
  hussen_delivered integer,
  hussen_returned integer,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint uq_equipment_protocol_category UNIQUE (protocol_id, category_id)
);
create index idx_equipments_protocol_id on public.protocol_equipments using btree (protocol_id);

create table public.shifts (
  id uuid default uuid_generate_v4() not null primary key,
  protocol_id uuid,          -- null = manual Stundenzettel shift
  user_id uuid,
  temp_worker_name text,     -- Zenjob/Rockit or unknown names
  position_role text not null,
  start_time time without time zone,
  end_time time without time zone,
  pause_mins integer,
  status text default 'offen'::text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  shift_date date,
  ort text,
  constraint shifts_status_check CHECK (status = ANY (ARRAY['offen','eingetragen']))
);
create index idx_shifts_user_id on public.shifts using btree (user_id);
create index idx_shifts_protocol_id on public.shifts using btree (protocol_id);
create unique index uq_shift_protocol_temp_time on public.shifts using btree (protocol_id, temp_worker_name, start_time, end_time)
  where protocol_id is not null and temp_worker_name is not null and temp_worker_name <> '—'::text;
create unique index uq_shift_protocol_user_time on public.shifts using btree (protocol_id, user_id, start_time, end_time)
  where protocol_id is not null and user_id is not null;

create table public.worker_ratings (
  id uuid default uuid_generate_v4() not null primary key,
  temp_worker_name text not null,
  protocol_id uuid,
  shift_id uuid,             -- never set by the app; ratings match by temp_worker_name
  rating text not null,
  is_star boolean default false,
  rated_by uuid,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint worker_ratings_rating_check CHECK (rating = ANY (ARRAY['up','down']))
);
create index idx_worker_ratings_protocol_id on public.worker_ratings using btree (protocol_id);

create table public.products (
  id uuid default uuid_generate_v4() not null primary key,
  name text not null,
  description text,
  pdf_url text,
  created_by uuid,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  content_text text
);

create table public.product_images (
  id uuid default uuid_generate_v4() not null primary key,
  product_id uuid not null,
  image_url text not null,
  sort_order integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  media_type text default 'image'::text not null,
  constraint product_images_media_type_check CHECK (media_type = ANY (ARRAY['image','video']))
);
create index idx_product_images_product_id on public.product_images using btree (product_id);

create table public.project_folders (
  id uuid default uuid_generate_v4() not null primary key,
  name text not null,
  description text,
  created_by uuid,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  parent_id uuid,
  pl_id uuid,
  ends_on date,              -- deletion date (cleanup-folders), top-level folders only
  notified_al_ids uuid[] default '{}'::uuid[] not null
);
create index idx_project_folders_parent on public.project_folders using btree (parent_id);

create table public.folder_files (
  id uuid default uuid_generate_v4() not null primary key,
  folder_id uuid not null,
  name text not null,
  file_url text not null,
  file_type text,
  file_size_bytes bigint,
  created_by uuid,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  note text,
  constraint folder_files_note_check CHECK (note IS NULL OR char_length(note) <= 500)
);
create index idx_folder_files_folder_id on public.folder_files using btree (folder_id);

create table public.folder_deletion_log (
  id uuid default gen_random_uuid() not null primary key,
  folder_name text not null,
  ends_on date,
  file_count integer default 0 not null,
  deleted_at timestamp with time zone default now() not null
);

create table public.einsaetze (
  id uuid default gen_random_uuid() not null primary key,
  folder_id uuid not null,
  date date not null,
  action text default 'Aufbau'::text not null,
  al_id uuid not null,
  cancelled boolean default false not null,
  created_at timestamp with time zone default now() not null
);
create index idx_einsaetze_folder_id on public.einsaetze using btree (folder_id);
create index idx_einsaetze_date on public.einsaetze using btree (date);
create index idx_einsaetze_al_id on public.einsaetze using btree (al_id);

create table public.reminder_log (
  einsatz_id uuid not null,
  day date not null,
  kind text not null,
  primary key (einsatz_id, day, kind),
  constraint reminder_log_kind_check CHECK (kind = ANY (ARRAY['push','pl_mail']))
);

create table public.push_subscriptions (
  endpoint text not null primary key,
  user_id uuid not null,
  p256dh text not null,
  auth text not null,
  created_at timestamp with time zone default now() not null
);
create index idx_push_subscriptions_user_id on public.push_subscriptions using btree (user_id);

create table public.plan_weeks (
  id uuid default gen_random_uuid() not null primary key,
  year integer not null,
  kw integer not null,
  week_start date not null,
  week_end date not null,
  version integer default 1 not null,
  notified_version integer default 0 not null,
  removed jsonb default '[]'::jsonb not null,
  file_name text,
  uploaded_by uuid,
  uploaded_at timestamp with time zone default now() not null,
  constraint plan_weeks_year_kw_key UNIQUE (year, kw)
);
create index plan_weeks_uploaded_by_idx on public.plan_weeks using btree (uploaded_by);

create table public.plan_shifts (
  id uuid default gen_random_uuid() not null primary key,
  week_id uuid not null,
  date date not null,
  sort integer default 0 not null,
  key text not null,
  venue text,
  location text,
  title text,
  details text,
  wann text,
  ap text,
  notes text,
  color text,
  open_slots jsonb default '[]'::jsonb not null,
  change_status text,
  ap_user_id uuid,
  constraint plan_shifts_change_status_check CHECK (change_status = ANY (ARRAY['neu','geändert']))
);
create index plan_shifts_week_id_idx on public.plan_shifts using btree (week_id);
create index plan_shifts_ap_user_id_idx on public.plan_shifts using btree (ap_user_id);
create index plan_shifts_date_idx on public.plan_shifts using btree (date);

create table public.plan_assignments (
  id uuid default gen_random_uuid() not null primary key,
  shift_id uuid not null,
  user_id uuid,
  name text not null,
  role text,
  note text
);
create index plan_assignments_user_id_idx on public.plan_assignments using btree (user_id);
create index plan_assignments_shift_id_idx on public.plan_assignments using btree (shift_id);

create table public.plan_name_aliases (
  alias text not null primary key,
  user_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create index plan_name_aliases_user_id_idx on public.plan_name_aliases using btree (user_id);

create table public.plan_reminder_log (
  al_id uuid not null,
  date date not null,
  day date not null,
  kind text not null,
  primary key (al_id, date, day, kind),
  constraint plan_reminder_log_kind_check CHECK (kind = ANY (ARRAY['push','pl_mail','evening']))
);

-- ══════════════ FOREIGN KEYS ══════════════

alter table public.app_settings add constraint app_settings_updated_by_fkey foreign key (updated_by) references public.app_users(id) on delete set null;
alter table public.protocols add constraint protocols_project_id_fkey foreign key (project_id) references public.projects(id);
alter table public.protocols add constraint protocols_al_id_fkey foreign key (al_id) references public.app_users(id);
alter table public.protocols add constraint protocols_pl_id_fkey foreign key (pl_id) references public.app_users(id);
alter table public.protocols add constraint protocols_created_by_fkey foreign key (created_by) references public.app_users(id);
alter table public.protocol_transports add constraint protocol_transports_protocol_id_fkey foreign key (protocol_id) references public.protocols(id) on delete cascade;
alter table public.protocol_transports add constraint protocol_transports_driver_user_id_fkey foreign key (driver_user_id) references public.app_users(id);
alter table public.protocol_equipments add constraint protocol_equipments_protocol_id_fkey foreign key (protocol_id) references public.protocols(id) on delete cascade;
-- Deleting a protocol deletes its shifts, also booked ('eingetragen') ones
alter table public.shifts add constraint shifts_protocol_id_fkey foreign key (protocol_id) references public.protocols(id) on delete cascade;
alter table public.shifts add constraint shifts_user_id_fkey foreign key (user_id) references public.app_users(id);
alter table public.worker_ratings add constraint worker_ratings_protocol_id_fkey foreign key (protocol_id) references public.protocols(id) on delete cascade;
alter table public.worker_ratings add constraint worker_ratings_shift_id_fkey foreign key (shift_id) references public.shifts(id) on delete set null;
alter table public.worker_ratings add constraint worker_ratings_rated_by_fkey foreign key (rated_by) references public.app_users(id);
alter table public.products add constraint products_created_by_fkey foreign key (created_by) references public.app_users(id);
alter table public.product_images add constraint product_images_product_id_fkey foreign key (product_id) references public.products(id) on delete cascade;
alter table public.project_folders add constraint project_folders_parent_id_fkey foreign key (parent_id) references public.project_folders(id) on delete cascade;
alter table public.project_folders add constraint project_folders_pl_id_fkey foreign key (pl_id) references public.app_users(id);
alter table public.project_folders add constraint project_folders_created_by_fkey foreign key (created_by) references public.app_users(id);
alter table public.folder_files add constraint folder_files_folder_id_fkey foreign key (folder_id) references public.project_folders(id) on delete cascade;
alter table public.folder_files add constraint folder_files_created_by_fkey foreign key (created_by) references public.app_users(id);
alter table public.einsaetze add constraint einsaetze_folder_id_fkey foreign key (folder_id) references public.project_folders(id) on delete cascade;
alter table public.einsaetze add constraint einsaetze_al_id_fkey foreign key (al_id) references public.app_users(id);
alter table public.reminder_log add constraint reminder_log_einsatz_id_fkey foreign key (einsatz_id) references public.einsaetze(id) on delete cascade;
alter table public.push_subscriptions add constraint push_subscriptions_user_id_fkey foreign key (user_id) references public.app_users(id) on delete cascade;
alter table public.plan_weeks add constraint plan_weeks_uploaded_by_fkey foreign key (uploaded_by) references public.app_users(id) on delete set null;
alter table public.plan_shifts add constraint plan_shifts_week_id_fkey foreign key (week_id) references public.plan_weeks(id) on delete cascade;
alter table public.plan_shifts add constraint plan_shifts_ap_user_id_fkey foreign key (ap_user_id) references public.app_users(id) on delete set null;
alter table public.plan_assignments add constraint plan_assignments_shift_id_fkey foreign key (shift_id) references public.plan_shifts(id) on delete cascade;
alter table public.plan_assignments add constraint plan_assignments_user_id_fkey foreign key (user_id) references public.app_users(id) on delete set null;
alter table public.plan_name_aliases add constraint plan_name_aliases_user_id_fkey foreign key (user_id) references public.app_users(id) on delete cascade;
alter table public.plan_reminder_log add constraint plan_reminder_log_al_id_fkey foreign key (al_id) references public.app_users(id) on delete cascade;

-- ══════════════ ROW LEVEL SECURITY ══════════════
-- RLS is on for every table. reminder_log and plan_reminder_log have no policy: only the Edge Functions (service_role) use them.

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Full access (all commands, every role)
create policy "Allow all" on public.folder_files for all to public using (true) with check (true);
create policy "Allow all" on public.product_images for all to public using (true) with check (true);
create policy "Allow all" on public.products for all to public using (true) with check (true);
create policy "Allow all" on public.project_folders for all to public using (true) with check (true);
create policy "Allow all" on public.worker_ratings for all to public using (true) with check (true);

-- anon: select/insert/update/delete
do $$ declare t text; begin
  foreach t in array array['einsaetze','plan_assignments','plan_name_aliases','plan_shifts','plan_weeks',
                           'protocol_equipments','protocols','push_subscriptions'] loop
    execute format('create policy anon_select_%1$s on public.%1$I for select to anon using (true)', t);
    execute format('create policy anon_insert_%1$s on public.%1$I for insert to anon with check (true)', t);
    execute format('create policy anon_update_%1$s on public.%1$I for update to anon using (true) with check (true)', t);
    execute format('create policy anon_delete_%1$s on public.%1$I for delete to anon using (true)', t);
  end loop;
end $$;

-- anon: tables with fewer commands
create policy anon_select_app_settings on public.app_settings for select to anon using (true);  -- writes only via set_app_settings
create policy "Allow anon read app_users" on public.app_users for select to anon using (true);
create policy anon_insert_app_users on public.app_users for insert to anon with check (true);
create policy anon_update_app_users on public.app_users for update to anon using (true)
  with check (role IS NULL OR role = ANY (ARRAY['MA','AL','PL','Buchhaltung','Admin','Gast']));
create policy "folder_deletion_log anon select" on public.folder_deletion_log for select to anon using (true);
create policy anon_select_projects on public.projects for select to anon using (true);
create policy anon_insert_projects on public.projects for insert to anon with check (true);
create policy anon_select_protocol_transports on public.protocol_transports for select to anon using (true);
create policy anon_insert_protocol_transports on public.protocol_transports for insert to anon with check (true);
create policy anon_delete_protocol_transports on public.protocol_transports for delete to anon using (true);
create policy anon_select_shifts on public.shifts for select to anon using (true);
create policy anon_insert_shifts on public.shifts for insert to anon with check (true);
create policy anon_update_shift_status on public.shifts for update to anon using (true)
  with check (status = ANY (ARRAY['offen','eingetragen']));
create policy anon_delete_shifts on public.shifts for delete to anon using (true);

-- Grants for anon (Supabase grants everything by default; these tables are narrower)
revoke insert, update, delete on public.app_settings, public.folder_deletion_log from anon;
revoke select, insert, update, delete on public.reminder_log, public.plan_reminder_log from anon;

-- ══════════════ FUNCTIONS ══════════════

-- Shared admin password, plain text. Replace <ADMIN_PIN> when restoring.
create or replace function public.verify_admin_pin(input_pin text)
 returns boolean language plpgsql security definer set search_path to ''
as $function$BEGIN
  RETURN input_pin = '<ADMIN_PIN>';
END;$function$;

-- Validates and writes app_settings; only called through set_app_settings (no grant for anon).
-- New settings keys must be added to the whitelist here.
create or replace function public.apply_app_settings(changes jsonb, actor uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
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
    else
      raise exception 'invalid_setting: %', k;
    end if;
  end loop;
  update public.app_settings s set value = c.value, updated_at = now(), updated_by = actor
    from jsonb_each(changes) c where s.key = c.key and s.value is distinct from c.value;
  return (select jsonb_object_agg(key, value) from public.app_settings);
end $function$;
revoke execute on function public.apply_app_settings(jsonb, uuid) from public, anon, authenticated;

create or replace function public.set_app_settings(input_pin text, changes jsonb, actor uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not coalesce(public.verify_admin_pin(input_pin), false) then
    raise exception 'invalid_pin';
  end if;
  return public.apply_app_settings(changes, actor);
end $function$;

-- ══════════════ SEED: app_settings (values as of 2026-11-02) ══════════════

insert into public.app_settings (key, value) values
  ('billing_cutoff', '20'),
  ('evening_push_enabled', 'true'),
  ('evening_push_hour', '18'),
  ('folder_autodelete_enabled', 'true'),
  ('folder_push_enabled', 'true'),
  ('mail_test_mode', 'false'),
  ('plan_change_push_enabled', 'true'),
  ('plan_reminders_enabled', 'true'),
  ('protocol_mail_enabled', 'true'),
  ('reminders_enabled', 'true'),
  ('vehicle_rates', '{"Hängerzug":{"wk":80,"sa":80,"so":80},"Solo":{"wk":70,"sa":70,"so":70},"Leih LKW":{"wk":0,"sa":0,"so":0},
    "Sprinter":{"wk":40,"sa":40,"so":40},"PKW":{"wk":20,"sa":20,"so":20},"Spedition":{"wk":0,"sa":0,"so":0},
    "Bischoff":{"wk":750,"sa":750,"so":837.5},"Rainer":{"wk":700,"sa":750,"so":750},"Hansetrans Solo":{"wk":250,"sa":250,"so":250}}')
on conflict (key) do nothing;

-- ══════════════ STORAGE ══════════════
-- Buckets (all public): product-images (10 MB, jpeg/png/gif/webp/svg), product-pdfs, product-videos, project-files.
-- Policies on storage.objects: anon select/insert/update/delete per bucket (product-images: select for everyone).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-images', 'product-images', true, 10485760, array['image/jpeg','image/png','image/gif','image/webp','image/svg+xml']),
  ('product-pdfs', 'product-pdfs', true, null, null),
  ('product-videos', 'product-videos', true, null, null),
  ('project-files', 'project-files', true, null, null)
on conflict (id) do nothing;

create policy "Public read product-images" on storage.objects for select to public using (bucket_id = 'product-images');
create policy "product-images anon insert" on storage.objects for insert to anon with check (bucket_id = 'product-images');
create policy "product-images anon update" on storage.objects for update to anon using (bucket_id = 'product-images');
create policy "product-images anon delete" on storage.objects for delete to anon using (bucket_id = 'product-images');
do $$ declare b text; begin
  foreach b in array array['product-pdfs','product-videos','project-files'] loop
    execute format('create policy %I on storage.objects for select to anon using (bucket_id = %L)', b || ' anon select', b);
    execute format('create policy %I on storage.objects for insert to anon with check (bucket_id = %L)', b || ' anon insert', b);
    execute format('create policy %I on storage.objects for update to anon using (bucket_id = %L)', b || ' anon update', b);
    execute format('create policy %I on storage.objects for delete to anon using (bucket_id = %L)', b || ' anon delete', b);
  end loop;
end $$;

-- ══════════════ CRON (pg_cron + pg_net, times in UTC) ══════════════
-- Stop one with: select cron.unschedule('<name>');

select cron.schedule('send-reminders-daily', '5,20,35,50 7,8 * * *', $$
  select net.http_post(url := 'https://jbrvghmkftvnkjmyoigv.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <ANON_KEY>'),
    body := '{}'::jsonb, timeout_milliseconds := 60000) $$);
select cron.schedule('send-evening-push', '5,20,35,50 13-21 * * *', $$
  select net.http_post(url := 'https://jbrvghmkftvnkjmyoigv.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <ANON_KEY>'),
    body := '{"mode":"evening"}'::jsonb, timeout_milliseconds := 60000) $$);
select cron.schedule('cleanup-folders-daily', '30 2 * * *', $$
  select net.http_post(url := 'https://jbrvghmkftvnkjmyoigv.supabase.co/functions/v1/cleanup-folders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <ANON_KEY>'),
    body := '{}'::jsonb, timeout_milliseconds := 60000) $$);
