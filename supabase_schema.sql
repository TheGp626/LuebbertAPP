-- Enable UUID extension (usually enabled by default in Supabase)
create extension if not exists "uuid-ossp";

-- 1. USERS TABLE
-- Stores profile information. Linked directly to auth.users.
create table public.app_users (
  id uuid references auth.users not null primary key,
  email text,
  full_name text,
  role text check (role in ('AL', 'MA', 'PL', 'Buchhaltung', 'Admin')) default 'MA',
  default_dept text default 'MA für Auf-/ Abbau',
  hourly_rate_conni numeric default 0,
  hourly_rate_internal numeric default 0,
  income_limit numeric default null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Trigger to automatically create an app_user profile when they sign up in auth
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.app_users (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

-- Trigger execution
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. PROJECTS TABLE
create table public.projects (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  location text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. PROTOCOLS TABLE
create table public.protocols (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references public.projects(id),
  date date not null,
  action text default 'Aufbau',
  is_holiday boolean default false,
  al_id uuid references public.app_users(id),
  pl_id uuid references public.app_users(id),
  al_name_fallback text, -- In case AL isn't a registered user
  pl_name_fallback text, -- In case PL isn't a registered user
  signature_text text, -- Base64 image data string
  total_cost numeric,
  notes_damages text,
  notes_incidents text,
  notes_feedback text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. PROTOCOL TRANSPORTS (Logistics array)
create table public.protocol_transports (
  id uuid default uuid_generate_v4() primary key,
  protocol_id uuid references public.protocols(id) on delete cascade not null,
  vehicle_type text not null,
  driver_name text,
  punctuality text,
  delay_mins integer,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. PROTOCOL EQUIPMENTS (Categories)
create table public.protocol_equipments (
  id uuid default uuid_generate_v4() primary key,
  protocol_id uuid references public.protocols(id) on delete cascade not null,
  category_id text not null,
  status text not null,
  note text,
  hussen_delivered integer,
  hussen_returned integer,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. SHIFTS TABLE (Personnel)
-- This bridges Protokoll and Stundenzettel!
create table public.shifts (
  id uuid default uuid_generate_v4() primary key,
  protocol_id uuid references public.protocols(id) on delete cascade,
  user_id uuid references public.app_users(id), -- For registered MAs/ALs
  temp_worker_name text, -- For Zenjob/Rockit/unregistered
  position_role text not null, -- 'MA fest', 'AL', 'Zenjob'
  start_time time, -- Store as 'HH:MM' string or Time
  end_time time,
  pause_mins integer,
  ort text,
  status text check (status in ('offen', 'eingetragen')) default 'offen',
  shift_date date, -- Actual work date (protocol date for Protokoll shifts, computed from week for Stundenzettel)
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 7. SET UP ROW LEVEL SECURITY (RLS)
alter table public.app_users enable row level security;
alter table public.projects enable row level security;
alter table public.protocols enable row level security;
alter table public.protocol_transports enable row level security;
alter table public.protocol_equipments enable row level security;
alter table public.shifts enable row level security;

-- Basic policy for development (Allows anyone logged in to do anything).
-- Later on, we will restrict MAs to only viewing their own shifts.
create policy "Allow all operations for authenticated users" on public.app_users for all to authenticated using (true);
create policy "Allow all operations for authenticated users" on public.projects for all to authenticated using (true);
create policy "Allow all operations for authenticated users" on public.protocols for all to authenticated using (true);
create policy "Allow all operations for authenticated users" on public.protocol_transports for all to authenticated using (true);
create policy "Allow all operations for authenticated users" on public.protocol_equipments for all to authenticated using (true);
create policy "Allow all operations for authenticated users" on public.shifts for all to authenticated using (true);

-- 8. WORKER RATINGS TABLE (Bewertungen für Zenjob/Rockit Mitarbeiter)
-- AL/PL können Zenjob/Rockit-Kräfte mit 👍👎⭐ bewerten.
create table public.worker_ratings (
  id uuid default uuid_generate_v4() primary key,
  temp_worker_name text not null,
  protocol_id uuid references public.protocols(id) on delete cascade,
  shift_id uuid references public.shifts(id) on delete set null,
  rating text check (rating in ('up', 'down')) not null,
  is_star boolean default false,
  rated_by uuid references public.app_users(id),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.worker_ratings enable row level security;
create policy "Allow all operations for authenticated users" on public.worker_ratings for all to authenticated using (true);

-- 9. PRODUCTS TABLE (Produktdatenbank mit PDF-Aufbauanleitungen + Bilder)
-- AL/PL/Admin können Produkte anlegen. Alle können lesen.
-- PDFs werden in Supabase Storage Bucket "product-pdfs" (public) gespeichert.
-- Bilder werden in Supabase Storage Bucket "product-images" (public) gespeichert.
create table public.products (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  description text,
  pdf_url text,
  content_text text,  -- Aufbauanleitung als Freitext
  created_by uuid references public.app_users(id),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.products enable row level security;
create policy "Allow all operations for authenticated users" on public.products for all to authenticated using (true);

-- 10. PRODUCT IMAGES TABLE (mehrere Bilder pro Produkt)
create table public.product_images (
  id uuid default uuid_generate_v4() primary key,
  product_id uuid references public.products(id) on delete cascade not null,
  image_url text not null,
  sort_order integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.product_images enable row level security;
create policy "Allow all" on public.product_images for all using (true) with check (true);
grant select, insert, update, delete on public.product_images to anon;

-- 11. PROJECT FOLDERS TABLE (Dateiablage / Google Drive Ersatz)
create table public.project_folders (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  description text,
  created_by uuid references public.app_users(id),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.project_folders enable row level security;
create policy "Allow all" on public.project_folders for all using (true) with check (true);
grant select, insert, update, delete on public.project_folders to anon;

-- 12. FOLDER FILES TABLE (Dateien innerhalb eines Ordners)
-- Dateien werden in Supabase Storage Bucket "project-files" (public) gespeichert.
create table public.folder_files (
  id uuid default uuid_generate_v4() primary key,
  folder_id uuid references public.project_folders(id) on delete cascade not null,
  name text not null,
  file_url text not null,
  file_type text,
  file_size_bytes bigint,
  created_by uuid references public.app_users(id),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.folder_files enable row level security;
create policy "Allow all" on public.folder_files for all using (true) with check (true);
grant select, insert, update, delete on public.folder_files to anon;

-- ══════════════════════════════════════════════════════════
-- MIGRATION: Run these in Supabase SQL Editor on existing DB
-- ══════════════════════════════════════════════════════════

-- Add employee rate columns
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS hourly_rate_conni numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hourly_rate_internal numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS income_limit numeric DEFAULT NULL;

-- Consolidate shift statuses: pending + approved → offen
UPDATE public.shifts SET status = 'offen' WHERE status IN ('pending', 'approved');
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_status_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_status_check CHECK (status IN ('offen', 'eingetragen'));
