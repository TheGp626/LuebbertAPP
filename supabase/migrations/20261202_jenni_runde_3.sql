-- Jenni, 25.11.2026:
-- 1. "Mit Vorbehalt": an „Ich kann“ (plan_shift_interest, order_applications) may carry a limit like "nur bis 16:00 Uhr"
--    or "erst ab 10:00 Uhr", written by the person with the Meldung and read by whoever decides. Short text, at most 40 chars.
-- 2. send-reminders logs the monthly "Check mal deine Stunden" push as plan_reminder_log kind 'hours_check'.
-- Rollback: supabase/rollback/20261202_jenni_runde_3_rollback.sql. Check: supabase/tests/jenni_runde_3_check.sql.

alter table public.plan_shift_interest add column if not exists vorbehalt text
  check (vorbehalt is null or char_length(vorbehalt) between 1 and 40);
alter table public.order_applications add column if not exists vorbehalt text
  check (vorbehalt is null or char_length(vorbehalt) between 1 and 40);

alter table public.plan_reminder_log drop constraint plan_reminder_log_kind_check;
alter table public.plan_reminder_log add constraint plan_reminder_log_kind_check
  check (kind = any (array['push', 'pl_mail', 'evening', 'hours_check']) or kind like 'pl_mail:%');
