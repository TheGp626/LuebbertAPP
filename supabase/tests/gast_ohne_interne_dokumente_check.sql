-- Check of 20261130_gast_ohne_interne_dokumente.sql (run after it is applied). Always rolls back: the last line raises.
do $$
declare gast uuid; ma uuid; n_all int; n_gast int; n_ma int; o_gast int; o_ma int;
begin
  if not public.is_internal_doc('1794576009145_nmlva_Auftragsbestaetigung_26-0463.pdf') then raise exception 'AB not internal'; end if;
  if not public.is_internal_doc('Angebot BER26-0193.pdf') or not public.is_internal_doc('Rechnung_2026_11.pdf') then raise exception 'Angebot/Rechnung not internal'; end if;
  if public.is_internal_doc('IPM_AG_FBF26_Setup_Foyer_3.pdf') or public.is_internal_doc('Aufbauplan Stehtisch.pdf') then raise exception 'plan counted as internal'; end if;
  select id into gast from public.app_users where role = 'Gast' and is_active is not false order by id limit 1;
  select id into ma from public.app_users where role = 'MA' and is_active is not false order by id limit 1;
  if gast is null or ma is null then raise exception 'need one active Gast and one MA'; end if;
  select count(*) into n_all from public.folder_files;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', gast, 'role', 'authenticated')::text, true);
  select count(*) into n_gast from public.folder_files;
  select count(*) into o_gast from storage.objects where bucket_id = 'project-files';
  if exists (select 1 from public.folder_files where public.is_internal_doc(name)) then raise exception 'Gast sees an internal file'; end if;
  if exists (select 1 from storage.objects where bucket_id = 'project-files' and public.is_internal_doc(name)) then raise exception 'Gast can download an internal file'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ma, 'role', 'authenticated')::text, true);
  select count(*) into n_ma from public.folder_files;
  select count(*) into o_ma from storage.objects where bucket_id = 'project-files';
  if n_ma <> n_all then raise exception 'MA must still see all % files, sees %', n_all, n_ma; end if;
  raise exception 'ALL CHECKS PASSED (rolled back): files all %, MA %, Gast %; storage MA %, Gast %', n_all, n_ma, n_gast, o_ma, o_gast;
end $$;
