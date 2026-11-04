-- Assertions for migration pl_add_workers. Run only inside a transaction that is rolled back.
do $$
declare
  v_pl uuid := gen_random_uuid();
  v_al uuid := gen_random_uuid();
  v_new uuid;
  ok boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values (v_pl, 'ZZ PLA PL', 'PL', true), (v_al, 'ZZ PLA AL', 'AL', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_pl, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.app_users (full_name, role, default_dept, hourly_rate_internal)
    values ('ZZ PLA neu', 'MA', 'MA frei', 15) returning id into v_new;
  insert into public.app_user_private (user_id, hourly_rate_conni, income_limit) values (v_new, 13, 556);
  ok := false;
  begin insert into public.app_users (full_name, role) values ('ZZ PLA admin', 'Admin');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: PL created an Admin'; end if;
  ok := false;
  begin insert into public.app_users (full_name, role) values ('ZZ PLA bh', 'Buchhaltung');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: PL created a Buchhaltung user'; end if;
  ok := false;
  begin update public.app_users set role = 'Admin' where id = v_new;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: update guard lost'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_al, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin insert into public.app_users (full_name, role) values ('ZZ PLA al-neu', 'MA');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: AL created a user'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;
select 'all pl_add_workers checks passed' as result;
