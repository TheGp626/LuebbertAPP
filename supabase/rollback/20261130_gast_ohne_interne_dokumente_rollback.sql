-- Rollback of 20261130_gast_ohne_interne_dokumente.sql: Gast sees every project file again (as before).
drop policy if exists rls_folder_files_select on public.folder_files;
create policy rls_folder_files_select on public.folder_files for select to authenticated using (true);
drop policy if exists rls_objects_select on storage.objects;
create policy rls_objects_select on storage.objects for select to authenticated
  using (bucket_id = any (array['project-files', 'product-images', 'product-pdfs', 'product-videos']));
drop function if exists public.is_internal_doc(text);
