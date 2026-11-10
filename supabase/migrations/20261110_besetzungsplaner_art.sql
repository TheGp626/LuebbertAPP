-- Besetzungsplaner: Art eines Einsatzes im Entwurf (Jennis Farben): auftrag = bestätigt (weiß), angebot = kann noch
-- wegfallen (blau), intern = intern und alles weitere (gelb), bus = Busfahrt (grün). null = noch nicht gewählt
-- (die App nimmt dann auftrag für Zeilen aus einer Auftragsbestätigung, sonst intern). Beim Veröffentlichen wird daraus
-- plan_shifts.color; der veröffentlichte Plan bekommt keine neue Spalte.
-- Rollback: supabase/rollback/20261110_besetzungsplaner_art_rollback.sql.
alter table public.plan_draft_shifts
  add column kind text check (kind in ('auftrag', 'angebot', 'intern', 'bus'));
