-- Wochenplan: sagen, WAS sich an einem Einsatz geändert hat (plan_shifts.change_fields, z.B. {Wann,Wer}), und im
-- Besetzungsplaner offene Plätze behalten, die keine MA-Plätze sind (plan_draft_shifts.open_other, z.B. ein fehlender Fahrer
-- oder "2 x Zenjob" aus Daniels PDF; ohne die Spalte gingen sie beim Veröffentlichen eines Entwurfs verloren).
-- Beides nur zusätzliche, leere Spalten. Rollback: supabase/rollback/20261110_plan_change_fields_rollback.sql.
-- added_user_ids: wer auf einem bestehenden Einsatz neu dazugekommen ist. Die Benachrichtigung (notify-plan-change) schickt
-- damit nur noch bei geänderter Zeit, bei neu dazugekommenen und bei herausgenommenen Personen eine Nachricht.
alter table public.plan_shifts add column change_fields text[];
alter table public.plan_shifts add column added_user_ids uuid[];
alter table public.plan_draft_shifts
  add column open_other jsonb not null default '[]'::jsonb check (jsonb_typeof(open_other) = 'array');
