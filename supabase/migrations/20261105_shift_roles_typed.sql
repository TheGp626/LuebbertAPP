-- Old shift positions "MA frei" / "AL fest" … → new "<Funktion> <Typ>" (2026-11-05, Patryk: "move old shifts, don't destroy anything").
-- fest → Fest; frei → the person's current type unless that is Fest (then Minijob, so a once-paid shift stays paid);
-- temp/agency names without account → Minijob. Only position_role changes: no status, times, people or totals.
-- Old values kept in public._shift_role_backup_20261105 (no access for app roles) and in backups/2026-11-05/ (local).
-- Undo: update public.shifts s set position_role = b.position_role from public._shift_role_backup_20261105 b where b.id = s.id;

create table if not exists public._shift_role_backup_20261105 (id uuid primary key, position_role text not null);
alter table public._shift_role_backup_20261105 enable row level security;
revoke all on public._shift_role_backup_20261105 from anon, authenticated;

insert into public._shift_role_backup_20261105 (id, position_role)
select id, position_role from public.shifts where position_role ~ '^(AL|MA|Fahrer) (frei|fest)$'
on conflict (id) do nothing;

update public.shifts s
   set position_role = split_part(s.position_role, ' ', 1) || ' ' ||
       case when split_part(s.position_role, ' ', 2) = 'fest' then 'Fest'
            when u.employment_type is null or u.employment_type = 'Fest' then 'Minijob'
            else u.employment_type end
  from public.shifts s0
  left join public.app_users u on u.id = s0.user_id
 where s0.id = s.id
   and s.position_role ~ '^(AL|MA|Fahrer) (frei|fest)$';
