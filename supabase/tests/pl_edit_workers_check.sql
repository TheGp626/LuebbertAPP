-- Assertions for migration pl_edit_workers. Run only inside a transaction that is rolled back; raises on the first
-- failed check. Temporary users 'ZZ PLW <Role>'.
do $$
declare
  v_pl    uuid := gen_random_uuid();
  v_ma    uuid := gen_random_uuid();
  v_al    uuid := gen_random_uuid();
  v_bh    uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  n int;
  ok boolean;
  r text;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values
    (v_pl, 'ZZ PLW PL', 'PL', true), (v_ma, 'ZZ PLW MA', 'MA', true), (v_al, 'ZZ PLW AL', 'AL', true),
    (v_bh, 'ZZ PLW Buchhaltung', 'Buchhaltung', true), (v_admin, 'ZZ PLW Admin', 'Admin', true);
  insert into public.app_user_private (user_id, hourly_rate_conni, email) values
    (v_ma, 12, 'ma@example.invalid'), (v_bh, 20, 'bh@example.invalid');

  -- ── PL ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_pl, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.app_user_private where user_id in (v_ma, v_bh);
  if n <> 2 then raise exception 'check failed: PL sees % of 2 private rows', n; end if;
  update public.app_users set role = 'AL', hourly_rate_internal = 17, role_rates = '[]'::jsonb where id = v_ma;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: PL could not change role/rates of an MA'; end if;
  update public.app_user_private set hourly_rate_conni = 15, email = 'neu@example.invalid' where user_id = v_ma;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: PL could not change pay/email of an MA'; end if;
  insert into public.app_user_private (user_id, income_limit) values (v_al, 556);
  update public.app_users set role = 'PL' where id = v_al;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: PL could not make an AL a PL'; end if;
  update public.app_users set is_active = false where id = v_al;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: PL could not deactivate a worker'; end if;
  update public.app_users set hourly_rate_internal = 18 where id = v_pl;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: PL could not edit own rates'; end if;

  ok := false;
  begin update public.app_users set role = 'Admin' where id = v_ma;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: PL assigned Admin'; end if;
  ok := false;
  begin update public.app_users set role = 'Buchhaltung' where id = v_ma;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: PL assigned Buchhaltung'; end if;
  ok := false;
  begin update public.app_users set role = 'MA' where id = v_bh;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: PL changed a Buchhaltung account'; end if;
  ok := false;
  begin update public.app_users set hourly_rate_internal = 1 where id = v_admin;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: PL edited an Admin account'; end if;
  ok := false;
  begin update public.app_users set role = 'AL' where id = v_pl;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: PL changed own role'; end if;
  update public.app_user_private set email = 'x@example.invalid' where user_id = v_bh;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'check failed: PL changed pay/email of Buchhaltung'; end if;
  ok := false;
  begin insert into public.app_user_private (user_id, email) values (v_admin, 'x@example.invalid');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: PL created a private row for an Admin'; end if;
  ok := false;
  begin insert into public.app_users (full_name, role) values ('ZZ PLW new', 'MA');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: PL created a user'; end if;
  reset role;

  -- ── AL: still no worker edits, no pay ──
  -- v_al is inactive now (= Gast): use the MA turned AL instead
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.app_user_private where user_id <> v_ma;
  if n <> 0 then raise exception 'check failed: AL sees % foreign private rows', n; end if;
  update public.app_users set hourly_rate_internal = 99 where id = v_pl;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'check failed: AL edited a worker'; end if;
  reset role;

  -- ── Buchhaltung: unchanged, may assign Admin ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_bh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.app_users set role = 'Admin' where id = v_pl;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: Buchhaltung could not assign Admin'; end if;
  reset role;

  select role into r from public.app_users where id = v_ma;
  if r is distinct from 'AL' then raise exception 'check failed: MA role is % instead of AL', r; end if;
  perform set_config('request.jwt.claims', '', true);
end $$;
select 'all pl_edit_workers checks passed' as result;
