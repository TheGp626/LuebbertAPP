-- Bewertungen für eigene Leute (Jenni, Briefing 26.11.2026): the AL rates each person in the protocol
-- ⭐ (hat Senior-Hand-Potenzial) · 👍 · okay (default, no row) · 👎; ⭐ and 👎 need a comment. No push, never shown to the
-- rated person: readable by Admin, PL, „Sieht Bewerbungen“ and whoever gave the rating. Agencies keep worker_ratings.
-- set_staff_ratings() replaces a protocol's list in one call; only rows by the caller are replaced, so two ALs editing
-- the same protocol keep each other's ratings.
-- Rollback: supabase/rollback/20261212_bewertungen_intern_rollback.sql. Check: supabase/tests/bewertungen_intern_check.sql.

create table public.staff_ratings (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.protocols(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  rating text not null check (rating in ('star', 'up', 'down')),
  comment text check (comment is null or char_length(comment) <= 500),
  rated_by uuid default auth.uid() references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (rating = 'up' or char_length(btrim(coalesce(comment, ''))) >= 3),
  unique (protocol_id, user_id, rated_by)
);
create index staff_ratings_user on public.staff_ratings (user_id, created_at);
alter table public.staff_ratings enable row level security;
revoke all on public.staff_ratings from public, anon, authenticated;
grant select on public.staff_ratings to authenticated;
grant all on public.staff_ratings to service_role;
create policy rls_staff_ratings_select on public.staff_ratings for select to authenticated
  using (rated_by = (select auth.uid()) or (select public.sees_plan_interest()) or (select public.app_role()) = 'PL');

-- rows: [{ "user_id": uuid, "rating": "star"|"up"|"down", "comment": text }]; nobody rates themselves
create or replace function public.set_staff_ratings(p_protocol uuid, rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n integer;
begin
  if (select public.app_role()) not in ('AL', 'PL', 'Buchhaltung', 'Admin') then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
  if rows is null or jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 200 then raise exception 'invalid_rows'; end if;
  if not exists (select 1 from public.protocols where id = p_protocol) then raise exception 'protocol_not_found'; end if;
  delete from public.staff_ratings where protocol_id = p_protocol and rated_by = me;
  insert into public.staff_ratings (protocol_id, user_id, rating, comment, rated_by)
    select distinct on ((r ->> 'user_id')::uuid) p_protocol, (r ->> 'user_id')::uuid, r ->> 'rating', nullif(btrim(r ->> 'comment'), ''), me
      from jsonb_array_elements(rows) r
     where nullif(r ->> 'user_id', '') is not null and (r ->> 'user_id')::uuid <> me;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.set_staff_ratings(uuid, jsonb) from public, anon;
grant execute on function public.set_staff_ratings(uuid, jsonb) to authenticated;
