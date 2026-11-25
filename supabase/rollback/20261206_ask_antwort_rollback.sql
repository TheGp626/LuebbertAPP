-- Rollback of 20261206_ask_antwort: the functions go, the columns (and the answers in them) go.
drop function if exists public.ask_answers(text[]);
drop function if exists public.answer_ask(bigint, text);
drop function if exists public.my_open_asks();
alter table public.ask_log drop column if exists answered_at, drop column if exists answer, drop column if exists label;
