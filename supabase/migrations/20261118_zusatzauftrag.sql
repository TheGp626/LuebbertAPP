-- Zusatzauftrag: a small job done alongside a bigger one ("Aufbau: im Zuge Breko"). Its protocol points at the
-- main protocol of that day and carries no personnel, transport or cost, so nobody's hours count twice.
-- Rollback: supabase/rollback/20261118_zusatzauftrag_rollback.sql. Check: supabase/tests/zusatzauftrag_check.sql.

alter table public.protocols add column side_of uuid references public.protocols(id) on delete set null;
alter table public.protocols add constraint protocols_side_of_not_self check (side_of is distinct from id);
create index protocols_side_of_idx on public.protocols (side_of);

-- A Zusatz never gets shifts: also an old app version that doesn't know side_of can't add a crew to it
create function public.shifts_side_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.protocol_id is not null and exists (select 1 from public.protocols p where p.id = new.protocol_id and p.side_of is not null) then
    raise exception 'Zusatzauftrag: Personal steht im Hauptprotokoll' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function public.shifts_side_guard() from public, anon, authenticated;
create trigger shifts_side_guard before insert or update of protocol_id on public.shifts
  for each row execute function public.shifts_side_guard();
