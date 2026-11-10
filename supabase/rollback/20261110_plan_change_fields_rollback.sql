-- Undo migration plan_change_fields. Manual; "geändert" stays, only the note what changed is lost.
alter table public.plan_draft_shifts drop column if exists open_other;
alter table public.plan_shifts drop column if exists change_fields;
