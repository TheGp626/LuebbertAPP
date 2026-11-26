-- Lieferscheine (easyjob Job Lieferschein, read since 26.11.2026) never replace the Auftragsbestätigung of the same job:
-- the four functions that read order_parsed took the newest file per job; now an Auftragsbestätigung comes first,
-- like ordJobs in the app. Also: protocol_change_noise gets a fixed search_path (Supabase advisor).
-- Rollback: supabase/rollback/20261213_lieferschein_nachrang_rollback.sql.

alter function public.protocol_change_noise(text) set search_path = public;

do $$
declare f text; def text; nd text;
begin
  foreach f in array array['public.order_slots()', 'public.planner_order_phases()'] loop
    def := pg_get_functiondef(f::regprocedure);
    nd := replace(def, 'order by j->>''jobNo'', f.created_at desc',
      'order by j->>''jobNo'', coalesce(p.result->>''kind'', '''') = ''lieferschein'', f.created_at desc');
    if nd = def then raise exception '%: anchor not found', f; end if;
    execute nd;
  end loop;
  foreach f in array array['public.order_check_group(text,text)', 'public.order_check_items(text)'] loop
    def := pg_get_functiondef(f::regprocedure);
    nd := replace(def, 'order by f.created_at desc, op.parsed_at desc',
      'order by coalesce(op.result->>''kind'', '''') = ''lieferschein'', f.created_at desc, op.parsed_at desc');
    if nd = def then raise exception '%: anchor not found', f; end if;
    execute nd;
  end loop;
end $$;
