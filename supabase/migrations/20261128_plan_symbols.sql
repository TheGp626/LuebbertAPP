-- Plan einlesen (Testversion, 23.11.2026): Namen der Symbole aus Raumplänen, für alle gemerkt.
-- sig = Art des Symbols + Umfang + Fläche (js/planlesen.js plSymbolKey). Lesen: alle mit Konto außer Gast;
-- schreiben: AL, PL, Admin (die Rollen, die Pläne einlesen). Keine personenbezogenen Daten außer updated_by.
-- Rollback: supabase/rollback/20261128_plan_symbols_rollback.sql. Prüfung: supabase/tests/plan_symbols_check.sql.
create table if not exists public.plan_symbols (
  sig        text primary key check (char_length(sig) <= 120),
  name       text not null default '' check (char_length(name) <= 80),
  ignore     boolean not null default false,
  updated_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.plan_symbols enable row level security;
revoke all on public.plan_symbols from anon;
grant select, insert, update on public.plan_symbols to authenticated;

drop policy if exists rls_plan_symbols_select on public.plan_symbols;
create policy rls_plan_symbols_select on public.plan_symbols for select to authenticated
  using ((select public.app_role()) <> 'Gast');
drop policy if exists rls_plan_symbols_insert on public.plan_symbols;
create policy rls_plan_symbols_insert on public.plan_symbols for insert to authenticated
  with check ((select public.app_role()) in ('AL', 'PL', 'Admin'));
drop policy if exists rls_plan_symbols_update on public.plan_symbols;
create policy rls_plan_symbols_update on public.plan_symbols for update to authenticated
  using ((select public.app_role()) in ('AL', 'PL', 'Admin'))
  with check ((select public.app_role()) in ('AL', 'PL', 'Admin'));
