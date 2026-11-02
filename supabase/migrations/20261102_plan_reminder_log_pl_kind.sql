-- send-reminders logs every mailed PL of a plan job as kind 'pl_mail:<pl_id>', so a retry after a failed mail
-- does not mail the PLs that already got it. The old check only allowed push/pl_mail/evening and rejected those rows.
alter table public.plan_reminder_log drop constraint plan_reminder_log_kind_check;
alter table public.plan_reminder_log add constraint plan_reminder_log_kind_check
  check (kind = any (array['push', 'pl_mail', 'evening']) or kind like 'pl_mail:%');
