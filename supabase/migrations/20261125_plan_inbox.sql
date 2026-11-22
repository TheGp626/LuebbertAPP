-- Plan-Postfach: poll-plan-inbox reads the app's Gmail inbox, stores PDFs from allowed senders (Daniel's Wochenplan mails)
-- in the private bucket plan-inbox and lists them in plan_inbox. PL/Admin open one in the Wochenplan, the normal import
-- preview runs in the browser (parser needs pdf.js), and "Übernehmen" marks it importiert. Nothing goes live unchecked.
-- Rollback: supabase/rollback/20261125_plan_inbox_rollback.sql.

create table public.plan_inbox (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,          -- Message-ID header: a mail is stored once, however often the inbox is polled
  from_addr text not null,
  subject text not null default '',
  file_name text not null,
  storage_path text not null,
  received_at timestamptz not null,
  status text not null default 'neu' check (status in ('neu', 'importiert', 'verworfen')),
  handled_by uuid references public.app_users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index plan_inbox_handled_by_idx on public.plan_inbox (handled_by);
create index plan_inbox_status_idx on public.plan_inbox (status, received_at desc);
alter table public.plan_inbox enable row level security;
revoke all on public.plan_inbox from public, anon;
grant select, update on public.plan_inbox to authenticated;
grant all on public.plan_inbox to service_role;

create policy rls_plan_inbox_select on public.plan_inbox for select to authenticated
  using ((select public.app_role()) in ('PL', 'Admin'));
-- Only status/handled_* may change; the function (service role) writes the rest
create policy rls_plan_inbox_update on public.plan_inbox for update to authenticated
  using ((select public.app_role()) in ('PL', 'Admin'))
  with check ((select public.app_role()) in ('PL', 'Admin'));
revoke update on public.plan_inbox from authenticated;
grant update (status, handled_by, handled_at) on public.plan_inbox to authenticated;

-- Private bucket; only the function writes, PL/Admin read
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('plan-inbox', 'plan-inbox', false, 10485760, array['application/pdf'])
  on conflict (id) do nothing;
create policy rls_objects_plan_inbox_select on storage.objects for select to authenticated
  using (bucket_id = 'plan-inbox' and (select public.app_role()) in ('PL', 'Admin'));

-- Poll every 15 minutes (not applied by this migration; replace <PROJECT_REF> and <ANON_KEY>).
-- Needs the secret PLAN_MAIL_FROM (comma-separated sender addresses) and IMAP enabled on the Gmail account:
--
-- select cron.schedule('poll-plan-inbox', '*/15 * * * *', $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/poll-plan-inbox',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <ANON_KEY>'),
--     body := '{}'::jsonb
--   );
-- $$);
