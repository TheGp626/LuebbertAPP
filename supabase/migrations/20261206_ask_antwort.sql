-- "Hast du Zeit?" with an answer (Patryk, 25.11.2026): the person gets a popup with the shift and answers Ja or Nein.
-- Ja = "Ich kann" (the app writes the Meldung as the person, RLS as always), then the answer is stored here.
-- Nein is stored here and shown to whoever decides, next to the person in the Einsatz.
-- Rollback: supabase/rollback/20261206_ask_antwort_rollback.sql. Check: supabase/tests/ask_antwort_check.sql.

alter table public.ask_log
  add column label text check (label is null or char_length(label) <= 120),
  add column answer text check (answer in ('ja', 'nein')),
  add column answered_at timestamptz;

-- My unanswered asks of the last 3 days (newest first), with the asker's first name
create or replace function public.my_open_asks()
returns table (id bigint, ref text, label text, asked_by_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.ref, a.label, split_part(coalesce(u.full_name, ''), ' ', 1), a.created_at
  from public.ask_log a left join public.app_users u on u.id = a.asked_by
  where a.user_id = (select auth.uid()) and a.answer is null and a.created_at > now() - interval '3 days'
  order by a.created_at desc limit 10;
$$;

-- Answer an own ask once
create or replace function public.answer_ask(p_id bigint, p_answer text)
returns boolean language sql volatile security definer set search_path = public as $$
  update public.ask_log set answer = p_answer, answered_at = now()
  where id = p_id and user_id = (select auth.uid()) and answer is null and p_answer in ('ja', 'nein')
  returning true;
$$;

-- Asks and answers about these shifts, for whoever decides Meldungen (same rule as the Meldungen themselves)
create or replace function public.ask_answers(p_refs text[])
returns table (ref text, user_id uuid, answer text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.ref, a.user_id, a.answer, a.created_at from public.ask_log a
  where public.sees_plan_interest() and a.ref = any (p_refs[1:200]);
$$;

revoke all on function public.my_open_asks() from public, anon;
revoke all on function public.answer_ask(bigint, text) from public, anon;
revoke all on function public.ask_answers(text[]) from public, anon;
grant execute on function public.my_open_asks() to authenticated;
grant execute on function public.answer_ask(bigint, text) to authenticated;
grant execute on function public.ask_answers(text[]) to authenticated;
