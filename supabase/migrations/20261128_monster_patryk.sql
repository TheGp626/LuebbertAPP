-- Testversion (23.11.2026): Patryks Monster-Zähler auf "Heute" für alle.
-- Ein MA darf fremde Schichten nicht lesen, deshalb rechnet die Datenbank nur die eine Zahl aus:
-- Stunden aller Schichten von Patryk (Pause ab, 3 h Minimum, über Mitternacht) / 5, abgerundet. Keine Namen, keine Zeiten.
-- Rollback: supabase/rollback/20261128_monster_patryk_rollback.sql
create or replace function public.monster_patryk() returns jsonb
language sql stable security definer set search_path = public as $$
  with p as (
    select id from public.app_users where full_name ilike 'patryk%' and is_active is not false order by created_at limit 1
  ), h as (
    select greatest(180, (extract(epoch from (s.end_time - s.start_time)) / 60
             + case when s.end_time <= s.start_time then 1440 else 0 end) - coalesce(s.pause_mins, 0)) / 60.0 as hours
    from public.shifts s join p on p.id = s.user_id
    where s.start_time is not null and s.end_time is not null
  )
  select case when exists (select 1 from p)
    then jsonb_build_object('cans', floor(coalesce(sum(hours), 0) / 5)::int, 'hours', round(coalesce(sum(hours), 0)))
    else null end
  from h;
$$;
revoke execute on function public.monster_patryk() from public, anon;
grant execute on function public.monster_patryk() to authenticated, service_role;
