-- Abteilungs-Mails (Spec "Mengen abhaken und Abteilungs-Mails", Teil B): after a protocol is saved, send-protocol-mail
-- sends Lager, Stoffe and Floristik a short mail when their area has feedback (status not okay, a note, missing Hussen).
-- department_mail_log remembers what went out, so a retry sends nothing twice and a later edit with new feedback sends
-- one "Ergänzung". Only the server (service_role) writes it; Admin may read it.
-- Settings: department_mail_enabled, department_mail_test_mode (both on: mails go to TEST_RECIPIENT),
-- department_routes (protocol area → department; '' = no mail). The addresses themselves are fixed in the server code.
-- Rollback: supabase/rollback/20261119_abteilungs_mails_rollback.sql. Check: supabase/tests/abteilungs_mails_check.sql.

create table public.department_mail_log (
  id bigint generated always as identity primary key,
  protocol_id uuid not null references public.protocols(id) on delete cascade,
  department text not null check (department in ('lager', 'stoffe', 'floristik')),
  items jsonb not null default '[]'::jsonb,   -- feedback lines that were in this mail
  items_hash text not null,
  is_supplement boolean not null default false,
  sent_to_test boolean not null default false,
  sent_at timestamptz not null default now(),
  unique (protocol_id, department, items_hash)
);
create index department_mail_log_protocol_idx on public.department_mail_log (protocol_id);
create index department_mail_log_sent_at_idx on public.department_mail_log (sent_at);
alter table public.department_mail_log enable row level security;
revoke all on public.department_mail_log from public, anon, authenticated;
grant select on public.department_mail_log to authenticated;
grant all on public.department_mail_log to service_role;

create policy rls_department_mail_log_select on public.department_mail_log for select to authenticated
  using ((select public.app_role()) = 'Admin');
-- No insert/update/delete policy: only service_role (bypasses RLS) writes

insert into public.app_settings (key, value) values
  ('department_mail_enabled', 'true'::jsonb),
  ('department_mail_test_mode', 'true'::jsonb),
  ('department_routes', '{"logistik": "lager", "mobiliar": "lager", "tischlerei": "", "stoffe": "stoffe", "floristik": "floristik"}'::jsonb)
on conflict (key) do nothing;

-- apply_app_settings has a fixed key whitelist: two more booleans and the routes object (rest unchanged)
do $$
declare def text := pg_get_functiondef('public.apply_app_settings(jsonb,uuid)'::regprocedure);
declare nd text;
begin
  nd := replace(def, '''folder_autodelete_enabled'', ''availability_for_all'')',
    '''folder_autodelete_enabled'', ''availability_for_all'', ''department_mail_enabled'', ''department_mail_test_mode'')');
  if nd = def then raise exception 'apply_app_settings: whitelist anchor not found'; end if;
  def := nd;
  nd := replace(def, 'elsif k = ''vehicle_rates'' then',
    'elsif k = ''department_routes'' then
      if jsonb_typeof(v) <> ''object''
         or exists (select 1 from jsonb_each(v) e(area, dep)
                    where area not in (''logistik'', ''mobiliar'', ''tischlerei'', ''stoffe'', ''floristik'')
                       or jsonb_typeof(dep) <> ''string''
                       or (dep #>> ''{}'') not in ('''', ''lager'', ''stoffe'', ''floristik'')) then
        raise exception ''invalid_setting: %'', k;
      end if;
    elsif k = ''vehicle_rates'' then');
  if nd = def then raise exception 'apply_app_settings: vehicle_rates anchor not found'; end if;
  execute nd;
end $$;
