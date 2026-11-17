-- "Kein Protokoll nötig": an Einsatz from the Wochenplan that won't get a protocol (cancelled, only a delivery, …).
-- Keyed by date + event name (lower case), like the "Einsätze ohne Protokoll" list groups them; plan shift ids change
-- with every upload. shift_keys = plan_shifts.key of all rooms of that event and day, so send-reminders can skip them.
-- No reason is stored on purpose. Rollback: supabase/rollback/20261117_protokoll_verzicht_rollback.sql.
-- Check: supabase/tests/protokoll_verzicht_check.sql.

create table public.protocol_waivers (
  date date not null,
  event_key text not null check (event_key <> ''),
  event_label text not null default '',
  shift_keys text[] not null default '{}',
  created_by uuid references public.app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (date, event_key)
);
create index protocol_waivers_created_by_idx on public.protocol_waivers (created_by);
alter table public.protocol_waivers enable row level security;
revoke all on public.protocol_waivers from public, anon;
grant select, insert, delete on public.protocol_waivers to authenticated;
grant all on public.protocol_waivers to service_role;

-- Everyone with an account except Gast may see what is marked (dates and event names are in the plan anyway)
create policy rls_protocol_waivers_select on public.protocol_waivers for select to authenticated
  using ((select public.app_role()) is not null and (select public.app_role()) <> 'Gast');
-- Who writes protocols may mark one as not needed, always in their own name
create policy rls_protocol_waivers_insert on public.protocol_waivers for insert to authenticated
  with check ((select public.app_role()) in ('AL', 'PL', 'Admin') and created_by = (select auth.uid()));
-- Undo: the one who marked it, or PL/Admin
create policy rls_protocol_waivers_delete on public.protocol_waivers for delete to authenticated
  using (created_by = (select auth.uid()) or (select public.app_role()) in ('PL', 'Admin'));
