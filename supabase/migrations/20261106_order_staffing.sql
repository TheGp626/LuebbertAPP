-- MA needed per sub-order (job number from the Auftragsbestätigung, e.g. '26-0447.01').
-- Only the numbers are stored; job details are re-read from the PDF in the project folder.
create table public.order_staffing (
  job_no text primary key check (job_no ~ '^\d{2}-\d{4}\.\d{2}$'),
  staff_setup smallint check (staff_setup between 0 and 99),
  staff_teardown smallint check (staff_teardown between 0 and 99),
  updated_by uuid references public.app_users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.order_staffing enable row level security;

create policy rls_order_staffing_select on public.order_staffing for select to authenticated
  using ((select public.app_role()) in ('Admin', 'PL'));
create policy rls_order_staffing_insert on public.order_staffing for insert to authenticated
  with check ((select public.app_role()) in ('Admin', 'PL'));
create policy rls_order_staffing_update on public.order_staffing for update to authenticated
  using ((select public.app_role()) in ('Admin', 'PL'))
  with check ((select public.app_role()) in ('Admin', 'PL'));
create policy rls_order_staffing_delete on public.order_staffing for delete to authenticated
  using ((select public.app_role()) in ('Admin', 'PL'));

grant select, insert, update, delete on public.order_staffing to authenticated;
