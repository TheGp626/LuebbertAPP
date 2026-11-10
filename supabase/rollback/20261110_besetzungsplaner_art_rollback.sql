-- Undo migration besetzungsplaner_art. Manual; the chosen Art of draft rows is lost, published plans keep their colours.
alter table public.plan_draft_shifts drop column if exists kind;
