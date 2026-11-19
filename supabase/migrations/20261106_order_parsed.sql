-- Parse results of Auftragsbestätigung PDFs (js/order-parser.js), so each PDF is read once instead of on every phone.
-- Filled by the first Admin/PL who opens "Aufträge"; rows older than ORDER_PARSER_VERSION are parsed again.
-- Phone numbers are stripped by the parser before anything is stored.
create table public.order_parsed (
  file_id uuid primary key references public.folder_files(id) on delete cascade,
  parser_version smallint not null,
  result jsonb not null,
  parsed_at timestamptz not null default now()
);
alter table public.order_parsed enable row level security;

create policy rls_order_parsed_select on public.order_parsed for select to authenticated
  using ((select public.app_role()) in ('Admin', 'PL'));
create policy rls_order_parsed_insert on public.order_parsed for insert to authenticated
  with check ((select public.app_role()) in ('Admin', 'PL'));
create policy rls_order_parsed_update on public.order_parsed for update to authenticated
  using ((select public.app_role()) in ('Admin', 'PL'))
  with check ((select public.app_role()) in ('Admin', 'PL'));
create policy rls_order_parsed_delete on public.order_parsed for delete to authenticated
  using ((select public.app_role()) in ('Admin', 'PL'));

grant select, insert, update, delete on public.order_parsed to authenticated;
