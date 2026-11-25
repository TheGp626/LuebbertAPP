-- Rollback of 20261203_jenni_runde_4. Deploy the previous app, send-protocol-mail and no ask-shift first.
-- The bucket protocol-photos stays (Supabase refuses deleting storage by SQL): empty and delete it in the dashboard
-- (Storage) if the photos should go too.
drop table if exists public.ask_log;
drop policy if exists rls_protocol_photos_select on storage.objects;
drop policy if exists rls_protocol_photos_insert on storage.objects;
drop policy if exists rls_protocol_photos_delete on storage.objects;
alter table public.protocols drop column if exists photos;
drop trigger if exists protocols_mark_edited on public.protocols;
drop function if exists public.protocols_mark_edited();
alter table public.protocols drop column if exists edited_by, drop column if exists edited_at;
alter table public.protocol_transports drop column if exists night;
update public.app_settings set value = (select jsonb_object_agg(name, r - 'na') from jsonb_each(value) e(name, r)) where key = 'vehicle_rates';

do $$
declare def text := pg_get_functiondef('public.apply_app_settings(jsonb,uuid)'::regprocedure);
declare nd text;
begin
  -- exact text the migration put in (a regex here would take its greediness from the first quantifier)
  nd := replace(def, 'or exists (select 1 from jsonb_object_keys(r) kk where kk not in (''wk'', ''sa'', ''so'', ''na''))
                       or (r ? ''na'' and (jsonb_typeof(r -> ''na'') <> ''number'' or (r ->> ''na'')::numeric not between 0 and 100000))',
    'or (select count(*) from jsonb_object_keys(r)) <> 3');
  if nd = def then raise exception 'apply_app_settings: nothing to roll back'; end if;
  execute nd;
end $$;
