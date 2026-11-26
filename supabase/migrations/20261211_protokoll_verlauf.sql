-- Protokoll-Verlauf (Jenni, Briefing 26.11.2026, "Protokolle bleiben bearbeitbar"): every change a person makes to a
-- protocol, its shifts, vehicles, equipment or Anwesenheit is logged with who, when, old and new value
-- (protocol_changes). Changes after the protocol was first mailed mark it "nach Versand geändert"
-- (protocols.changed_after_mail_at; first_mailed_at keeps the first mail, mailed_at moves with every re-send).
-- Inserts in the first 5 minutes after the protocol was created are its first save, not a change, and are not logged.
-- Rollback: supabase/rollback/20261211_protokoll_verlauf_rollback.sql. Check: supabase/tests/protokoll_verlauf_check.sql.

alter table public.protocols
  add column if not exists first_mailed_at timestamptz,
  add column if not exists changed_after_mail_at timestamptz;
update public.protocols set first_mailed_at = mailed_at where first_mailed_at is null and mailed_at is not null;

create table public.protocol_changes (
  id bigint generated always as identity primary key,
  protocol_id uuid not null,                -- no FK: rows of a deleted protocol are cleaned up by the trigger below
  table_name text not null,
  row_id uuid,
  subject text,                             -- whom / what the row is about: person, vehicle, equipment area
  action text not null check (action in ('insert', 'update', 'delete')),
  old_values jsonb,
  new_values jsonb,
  changed_by uuid references public.app_users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index protocol_changes_protocol on public.protocol_changes (protocol_id, changed_at);
alter table public.protocol_changes enable row level security;
revoke all on public.protocol_changes from public, anon, authenticated;
grant select on public.protocol_changes to authenticated;
grant all on public.protocol_changes to service_role;
create policy rls_protocol_changes_select on public.protocol_changes for select to authenticated
  using ((select public.app_role()) in ('AL', 'PL', 'Buchhaltung', 'Admin'));

-- Keys that are bookkeeping, not protocol content (status is content only for the Anwesenheit; the signature is too big)
create or replace function public.protocol_change_noise(tbl text) returns text[]
language sql immutable as $$
  select array['id', 'created_at', 'created_by', 'edited_by', 'edited_at', 'mailed_at', 'first_mailed_at', 'changed_after_mail_at',
               'approved_at', 'approved_by', 'self_entered', 'alerted_at', 'protocol_id', 'signature_text']
         || case when tbl = 'protocol_attendance' then array[]::text[] else array['status'] end
$$;

create or replace function public.log_protocol_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pid uuid; p record; o jsonb; n jsonb; r jsonb; k text; oc jsonb := '{}'; nc jsonb := '{}'; act text := lower(tg_op); subj text;
begin
  if (select auth.uid()) is null then return null; end if;   -- service role / cron: mails, cleanups
  o := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  pid := case when tg_table_name = 'protocols' then coalesce(n, o) ->> 'id' else coalesce(n, o) ->> 'protocol_id' end;
  if pid is null then return null; end if;                    -- shifts without protocol
  select id, created_at, first_mailed_at into p from public.protocols where id = pid;
  if not found then return null; end if;                      -- the protocol itself is being deleted
  if tg_op = 'INSERT' and p.created_at > now() - interval '5 minutes' then return null; end if;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k <> all (public.protocol_change_noise(tg_table_name)) and (o -> k) is distinct from (n -> k) then
        oc := oc || jsonb_build_object(k, o -> k);
        nc := nc || jsonb_build_object(k, n -> k);
      end if;
    end loop;
    if oc = '{}'::jsonb then return null; end if;
  else
    oc := case when o is null then null else o - public.protocol_change_noise(tg_table_name) end;
    nc := case when n is null then null else n - public.protocol_change_noise(tg_table_name) end;
  end if;

  r := coalesce(n, o);
  subj := case tg_table_name
    when 'shifts' then coalesce((select full_name from public.app_users where id = (r ->> 'user_id')::uuid), r ->> 'temp_worker_name')
    when 'protocol_attendance' then coalesce((select full_name from public.app_users where id = (r ->> 'user_id')::uuid), r ->> 'temp_worker_name')
    when 'protocol_transports' then r ->> 'vehicle_type'
    when 'protocol_equipments' then r ->> 'category_id' end;
  insert into public.protocol_changes (protocol_id, table_name, row_id, subject, action, old_values, new_values, changed_by)
  values (pid, tg_table_name, (r ->> 'id')::uuid, subj, act, oc, nc, (select auth.uid()));
  if p.first_mailed_at is not null then
    update public.protocols set changed_after_mail_at = now() where id = pid;
  end if;
  return null;
end $$;
revoke execute on function public.log_protocol_change() from public, anon, authenticated;

create trigger log_protocol_change after update on public.protocols
  for each row execute function public.log_protocol_change();
create trigger log_protocol_change after insert or update or delete on public.shifts
  for each row execute function public.log_protocol_change();
create trigger log_protocol_change after insert or update or delete on public.protocol_transports
  for each row execute function public.log_protocol_change();
create trigger log_protocol_change after insert or update or delete on public.protocol_equipments
  for each row execute function public.log_protocol_change();
create trigger log_protocol_change after insert or update or delete on public.protocol_attendance
  for each row execute function public.log_protocol_change();

-- first_mailed_at: set once, on the first mail
create or replace function public.protocols_first_mail() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.mailed_at is not null and old.first_mailed_at is null then new.first_mailed_at := new.mailed_at; end if;
  if old.first_mailed_at is not null then new.first_mailed_at := old.first_mailed_at; end if;
  return new;
end $$;
create trigger protocols_first_mail before update of mailed_at, first_mailed_at on public.protocols
  for each row execute function public.protocols_first_mail();

-- A deleted protocol takes its history along
create or replace function public.protocols_drop_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.protocol_changes where protocol_id = old.id;
  return old;
end $$;
revoke execute on function public.protocols_drop_changes() from public, anon, authenticated;
create trigger protocols_drop_changes after delete on public.protocols
  for each row execute function public.protocols_drop_changes();
