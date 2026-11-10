-- Undo migration plan_change_fields. Manual; "geändert" stays, only the note what changed is lost.
alter table public.plan_draft_shifts drop column if exists open_other;
-- Deploy the previous notify-plan-change first: the current one selects these columns.
alter table public.plan_shifts drop column if exists added_user_ids;
alter table public.plan_shifts drop column if exists change_fields;
