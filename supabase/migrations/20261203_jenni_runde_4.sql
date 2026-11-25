-- Jenni, 25.11.2026, round 4:
-- 1. Nachtfahrt: protocol_transports.night; vehicle_rates may carry an optional night rate "na" (€ 0–100000).
-- 2. Protokoll bearbeiten: protocols.edited_by / edited_at, set on every change by a person ("Zuletzt bearbeitet").
-- 3. Fotos im Protokoll: protocols.photos (storage paths, at most 8) and the private bucket protocol-photos
--    (JPEG, at most 3 MB each); the roles that write protocols upload, read and delete.
-- 4. "Hast du Zeit?": ask_log (who asked whom about which shift; written only by the Edge Function ask-shift).
-- Rollback: supabase/rollback/20261203_jenni_runde_4_rollback.sql. Check: supabase/tests/jenni_runde_4_check.sql.

-- ── 1. Nachtfahrt ──
alter table public.protocol_transports add column if not exists night boolean not null default false;

do $$
declare def text := pg_get_functiondef('public.apply_app_settings(jsonb,uuid)'::regprocedure);
declare nd text;
begin
  nd := replace(def, 'or (select count(*) from jsonb_object_keys(r)) <> 3',
    'or exists (select 1 from jsonb_object_keys(r) kk where kk not in (''wk'', ''sa'', ''so'', ''na''))
                       or (r ? ''na'' and (jsonb_typeof(r -> ''na'') <> ''number'' or (r ->> ''na'')::numeric not between 0 and 100000))');
  if nd = def then raise exception 'apply_app_settings: vehicle key count anchor not found'; end if;
  execute nd;
end $$;

-- ── 2. Zuletzt bearbeitet ──
alter table public.protocols
  add column if not exists edited_by uuid references public.app_users(id) on delete set null,
  add column if not exists edited_at timestamptz;

-- Only changes by a person count (the mail function's mailed_at runs as service_role without auth.uid())
create or replace function public.protocols_mark_edited() returns trigger
language plpgsql set search_path = public as $$
begin
  if (select auth.uid()) is not null then
    new.edited_by := (select auth.uid());
    new.edited_at := now();
  else
    new.edited_by := old.edited_by;
    new.edited_at := old.edited_at;
  end if;
  return new;
end $$;
drop trigger if exists protocols_mark_edited on public.protocols;
create trigger protocols_mark_edited before update on public.protocols
  for each row execute function public.protocols_mark_edited();

-- ── 3. Fotos ──
alter table public.protocols add column if not exists photos jsonb
  check (photos is null or (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 8));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('protocol-photos', 'protocol-photos', false, 3145728, array['image/jpeg'])
on conflict (id) do nothing;

create policy rls_protocol_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'protocol-photos' and (select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin'));
create policy rls_protocol_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'protocol-photos' and (select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin')
    and name ~ '^\d{4}-\d{2}/[0-9a-f-]{36}\.jpg$');
create policy rls_protocol_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'protocol-photos' and (select public.app_role()) in ('PL', 'Buchhaltung', 'Admin'));

-- ── 4. Hast du Zeit? ──
create table public.ask_log (
  id bigint generated always as identity primary key,
  asked_by uuid references public.app_users(id) on delete set null,
  user_id uuid not null references public.app_users(id) on delete cascade,
  ref text not null check (char_length(ref) between 1 and 260),
  created_at timestamptz not null default now(),
  unique (user_id, ref)
);
create index ask_log_asked_by_idx on public.ask_log (asked_by, created_at);
alter table public.ask_log enable row level security;
revoke all on public.ask_log from public, anon, authenticated;
grant all on public.ask_log to service_role;
-- No policies: only the Edge Function (service_role) reads and writes
