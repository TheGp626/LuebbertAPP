-- Check of 20261127_admin_ohne_passwort.sql (run after it is applied). Always rolls back: the last line raises.
do $$
declare
  adm uuid; ma uuid; pl uuid; v jsonb; old_cut jsonb; n int; failed boolean;
begin
  select id into adm from public.app_users where role = 'Admin' and is_active is not false order by id limit 1;
  select id into ma from public.app_users where role = 'MA' and is_active is not false and not coalesce(plans_week, false) order by id limit 1;
  if adm is null or ma is null then raise exception 'need one active Admin and one MA'; end if;
  select value into old_cut from public.app_settings where key = 'billing_cutoff';

  -- Admin saves without a password
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.save_app_settings('{"billing_cutoff": 17}'::jsonb);
  select value into v from public.app_settings where key = 'billing_cutoff';
  if v <> '17'::jsonb then raise exception 'admin save: billing_cutoff is %', v; end if;

  -- invalid values are still rejected (apply_app_settings validates)
  failed := false;
  begin perform public.save_app_settings('{"billing_cutoff": 99}'::jsonb); exception when others then failed := true; end;
  if not failed then raise exception 'invalid value must be rejected'; end if;

  -- an MA may not save
  perform set_config('request.jwt.claims', json_build_object('sub', ma, 'role', 'authenticated')::text, true);
  failed := false;
  begin perform public.save_app_settings('{"billing_cutoff": 5}'::jsonb); exception when others then failed := sqlerrm = 'forbidden'; end;
  if not failed then raise exception 'MA must get forbidden'; end if;

  -- planner delete policy exists and is limited to plans_week()
  select count(*) into n from pg_policies where tablename = 'order_plan_links' and policyname = 'rls_order_plan_links_delete_planner'
    and cmd = 'DELETE' and qual like '%plans_week()%';
  if n <> 1 then raise exception 'planner delete policy missing'; end if;

  -- anon may not call it
  if has_function_privilege('anon', 'public.save_app_settings(jsonb)', 'execute') then raise exception 'anon can execute'; end if;

  raise exception 'ALL CHECKS PASSED (rolled back)';
end $$;
