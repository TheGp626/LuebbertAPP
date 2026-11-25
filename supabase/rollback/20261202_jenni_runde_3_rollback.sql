-- Rollback of 20261202_jenni_runde_3. Deploy the previous app and send-reminders first.
alter table public.plan_shift_interest drop column if exists vorbehalt;
alter table public.order_applications drop column if exists vorbehalt;
delete from public.plan_reminder_log where kind = 'hours_check';
alter table public.plan_reminder_log drop constraint plan_reminder_log_kind_check;
alter table public.plan_reminder_log add constraint plan_reminder_log_kind_check
  check (kind = any (array['push', 'pl_mail', 'evening']) or kind like 'pl_mail:%');
