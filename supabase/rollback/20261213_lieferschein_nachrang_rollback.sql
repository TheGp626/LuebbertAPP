-- Rollback of 20261213_lieferschein_nachrang: newest file per job wins again.
do $$
declare f text; def text; nd text;
begin
  foreach f in array array['public.order_slots()', 'public.planner_order_phases()', 'public.order_check_group(text,text)', 'public.order_check_items(text)'] loop
    def := pg_get_functiondef(f::regprocedure);
    nd := replace(replace(def, 'coalesce(p.result->>''kind'', '''') = ''lieferschein'', ', ''), 'coalesce(op.result->>''kind'', '''') = ''lieferschein'', ', '');
    if nd <> def then execute nd; end if;
  end loop;
end $$;
