-- Gast (Zenjob/Rockit, Login ohne PIN) sieht keine internen Dokumente mehr (24.11.2026).
-- Der Gast-Zugang braucht keine PIN und die App-Adresse ist öffentlich: bisher konnte darüber jeder alle Dateien der
-- Projektordner lesen, auch Auftragsbestätigungen, Angebote und Rechnungen (Kunden, Preise, Kontakte).
-- Intern ist eine Datei an ihrem Namen erkennbar (wie im Modul Aufträge); der Speicherpfad enthält den Dateinamen,
-- deshalb gilt die Regel für die Dateiliste (folder_files) und für den Download (storage project-files) gleich.
-- Alle anderen Rollen sehen alles wie bisher. Rollback: supabase/rollback/20261130_gast_ohne_interne_dokumente_rollback.sql.
-- Prüfung: supabase/tests/gast_ohne_interne_dokumente_check.sql.

create or replace function public.is_internal_doc(name text) returns boolean
language sql immutable parallel safe set search_path = public as $$
  select coalesce(name, '') ~* '(auftrags?best|angebot|rechnung|kalkulation|kostenvoranschlag)';
$$;
grant execute on function public.is_internal_doc(text) to authenticated, service_role;

drop policy if exists rls_folder_files_select on public.folder_files;
create policy rls_folder_files_select on public.folder_files for select to authenticated
  using ((select public.app_role()) <> 'Gast' or not public.is_internal_doc(name));

drop policy if exists rls_objects_select on storage.objects;
create policy rls_objects_select on storage.objects for select to authenticated
  using (bucket_id = any (array['project-files', 'product-images', 'product-pdfs', 'product-videos'])
    and (bucket_id <> 'project-files' or (select public.app_role()) <> 'Gast' or not public.is_internal_doc(name)));
