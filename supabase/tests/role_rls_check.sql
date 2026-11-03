-- Assertions for migration role_rls, per role. Run only inside a transaction that is rolled back
-- (after the migration body); raises on the first failed check. Never apply as a migration.
-- Inserts temporary users 'ZZ RLS <Role>' with their own rows; the rollback removes them.
-- "Must fail" probes catch only insufficient_privilege (RLS violation or booking guard), so a typo cannot pass.
do $$
declare
  v_gast  uuid := gen_random_uuid();
  v_ma    uuid := gen_random_uuid();
  v_al    uuid := gen_random_uuid();
  v_pl    uuid := gen_random_uuid();
  v_bh    uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_del   uuid := gen_random_uuid();
  p_ma    uuid := gen_random_uuid();  -- protocol with a shift of the MA
  p_other uuid := gen_random_uuid();  -- protocol without
  s_open   uuid := gen_random_uuid(); -- MA manual shift, 'offen'
  s_booked uuid := gen_random_uuid(); -- MA protocol shift, 'eingetragen'
  s_new   uuid;
  n_users int;
  n_private int;
  n int;
  ok boolean;
  tok uuid;
  st text;
begin
  -- ── setup (as owner, no JWT: the booking guard does not apply) ──
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values
    (v_gast, 'ZZ RLS Gast', 'Gast', true), (v_ma, 'ZZ RLS MA', 'MA', true), (v_al, 'ZZ RLS AL', 'AL', true),
    (v_pl, 'ZZ RLS PL', 'PL', true), (v_bh, 'ZZ RLS Buchhaltung', 'Buchhaltung', true),
    (v_admin, 'ZZ RLS Admin', 'Admin', true), (v_del, 'ZZ RLS Delete', 'MA', true);
  -- Gast gets no private row and no shift: the policies show a user's own rows, the matrix gives Gast none
  insert into public.app_user_private (user_id, hourly_rate_conni, income_limit, email)
  select u, 12.5, 556, 'zz-rls@example.invalid' from unnest(array[v_ma, v_al, v_pl, v_bh, v_admin, v_del]) u;
  insert into public.protocols (id, date) values (p_ma, current_date), (p_other, current_date);
  insert into public.shifts (id, user_id, protocol_id, position_role, status, shift_date) values
    (s_open, v_ma, null, 'MA', 'offen', current_date),
    (s_booked, v_ma, p_ma, 'MA', 'eingetragen', current_date),
    (gen_random_uuid(), v_al, p_other, 'AL', 'offen', current_date),
    (gen_random_uuid(), v_pl, null, 'PL', 'offen', current_date),
    (gen_random_uuid(), v_bh, null, 'MA', 'offen', current_date),
    (gen_random_uuid(), v_admin, null, 'MA', 'offen', current_date);
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values ('zz-rls-endpoint', v_ma, 'x', 'x');
  insert into public.products (name) values ('ZZ RLS product');
  insert into public.project_folders (name) values ('ZZ RLS folder');
  select count(*) into n_users from public.app_users;
  select count(*) into n_private from public.app_user_private;

  -- ── catalog ──
  select count(*) into n from pg_policies
   where schemaname in ('public', 'storage') and policyname not like 'rls\_%'
     and ('authenticated' = any(roles) or 'public' = any(roles))
     and (schemaname = 'storage' and tablename = 'objects'
          or schemaname = 'public' and tablename in ('app_users', 'app_user_private', 'shifts', 'protocols',
             'protocol_transports', 'protocol_equipments', 'worker_ratings', 'projects', 'plan_weeks', 'plan_shifts',
             'plan_assignments', 'plan_name_aliases', 'einsaetze', 'project_folders', 'folder_files', 'products',
             'product_images', 'app_settings', 'folder_deletion_log', 'push_subscriptions'));
  if n <> 0 then raise exception 'check failed: % old authenticated/public policies left', n; end if;
  if exists (select 1 from pg_policies where policyname = 'rls_app_user_private_tmp') then
    raise exception 'check failed: rls_app_user_private_tmp still exists';
  end if;
  if not exists (select 1 from public._rls_policy_backup) then raise exception 'check failed: policy backup empty'; end if;
  if has_table_privilege('authenticated', 'public._rls_policy_backup', 'select')
     or has_table_privilege('anon', 'public._rls_policy_backup', 'select') then
    raise exception 'check failed: policy backup readable by a client role';
  end if;
  if exists (select 1 from public.app_users where hourly_rate_conni is not null or income_limit is not null or email is not null) then
    raise exception 'check failed: app_users still holds pay, limit or email';
  end if;

  -- ── EXECUTE rights ──
  if not has_function_privilege('anon', 'public.login_names()', 'execute')
     or not has_function_privilege('authenticated', 'public.login_names()', 'execute') then
    raise exception 'check failed: login_names not executable';
  end if;
  if not has_function_privilege('authenticated', 'public.set_app_settings(text, jsonb, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.verify_admin_pin(text)', 'execute')
     or not has_function_privilege('service_role', 'public.verify_admin_pin(text)', 'execute') then
    raise exception 'check failed: set_app_settings/verify_admin_pin right lost';
  end if;
  if not has_function_privilege('service_role', 'public.pin_register_failure(uuid, int, int)', 'execute')
     or has_function_privilege('authenticated', 'public.pin_register_failure(uuid, int, int)', 'execute')
     or has_function_privilege('anon', 'public.pin_register_failure(uuid, int, int)', 'execute') then
    raise exception 'check failed: pin_register_failure rights wrong';
  end if;
  if not has_function_privilege('authenticated', 'public.app_role()', 'execute')
     or not has_function_privilege('authenticated', 'public.user_directory()', 'execute')
     or not has_function_privilege('authenticated', 'public.renew_calendar_token()', 'execute')
     or not has_function_privilege('authenticated', 'public.register_push_subscription(text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.register_push_subscription(text, text, text)', 'execute') then
    raise exception 'check failed: app_role/user_directory/renew_calendar_token/register_push_subscription rights wrong';
  end if;

  -- ── Gast ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_gast, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.shifts;           if n <> 0 then raise exception 'check failed: Gast sees % shifts', n; end if;
  select count(*) into n from public.protocols;        if n <> 0 then raise exception 'check failed: Gast sees % protocols', n; end if;
  select count(*) into n from public.plan_shifts;      if n <> 0 then raise exception 'check failed: Gast sees % plan_shifts', n; end if;
  select count(*) into n from public.plan_weeks;       if n <> 0 then raise exception 'check failed: Gast sees % plan_weeks', n; end if;
  select count(*) into n from public.app_user_private; if n <> 0 then raise exception 'check failed: Gast sees % app_user_private', n; end if;
  select count(*) into n from public.products;         if n = 0 then raise exception 'check failed: Gast sees no products'; end if;
  select count(*) into n from public.project_folders;  if n = 0 then raise exception 'check failed: Gast sees no project_folders'; end if;
  select count(*) into n from public.user_directory(); if n = 0 then raise exception 'check failed: Gast user_directory empty'; end if;
  ok := false;
  begin
    insert into storage.objects (bucket_id, name) values ('project-files', 'zz-rls-gast.txt');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'check failed: Gast could upload to project-files'; end if;
  reset role;

  -- ── MA ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.app_user_private where user_id = v_ma;
  if n <> 1 then raise exception 'check failed: MA sees % own private rows', n; end if;
  select count(*) into n from public.app_user_private where user_id <> v_ma;
  if n <> 0 then raise exception 'check failed: MA sees % foreign private rows', n; end if;
  select count(*) into n from public.shifts where user_id is distinct from v_ma;
  if n <> 0 then raise exception 'check failed: MA sees % foreign shifts', n; end if;
  select count(*) into n from public.shifts where user_id = v_ma;
  if n <> 2 then raise exception 'check failed: MA sees % own shifts instead of 2', n; end if;
  select count(*) into n from public.protocols;
  if n <> 1 then raise exception 'check failed: MA sees % protocols instead of 1 (own shift)', n; end if;
  select count(*) into n from public.protocols where id = p_other;
  if n <> 0 then raise exception 'check failed: MA sees a protocol without own shift'; end if;
  insert into public.shifts (user_id, position_role, status, shift_date)
    values (v_ma, 'MA', 'offen', current_date) returning id into s_new;
  ok := false;
  begin
    insert into public.shifts (user_id, position_role, status, shift_date) values (v_al, 'MA', 'offen', current_date);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'check failed: MA inserted a shift for another user'; end if;
  ok := false;
  begin
    insert into public.shifts (user_id, position_role, status, shift_date) values (v_ma, 'MA', 'eingetragen', current_date);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'check failed: MA inserted a booked shift'; end if;
  update public.app_users set role = 'Admin' where id = v_ma;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'check failed: MA changed own role'; end if;
  update public.shifts set position_role = 'AL' where id = s_open;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'check failed: MA updated a shift'; end if;
  delete from public.shifts where id = s_booked;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'check failed: MA deleted a booked protocol shift'; end if;
  delete from public.shifts where id = s_new;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: MA could not delete own open manual shift'; end if;
  select count(*) into n from public.push_subscriptions where endpoint = 'zz-rls-endpoint';
  if n <> 1 then raise exception 'check failed: MA does not see own push subscription'; end if;
  tok := public.renew_calendar_token();
  if tok is null then raise exception 'check failed: renew_calendar_token returned null'; end if;
  reset role;

  -- ── AL ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_al, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.app_users;
  if n <> n_users then raise exception 'check failed: AL sees % of % app_users', n, n_users; end if;
  select count(*) into n from public.app_user_private where user_id <> v_al;
  if n <> 0 then raise exception 'check failed: AL sees % foreign private rows', n; end if;
  ok := false;
  begin
    update public.shifts set status = 'eingetragen' where id = s_open;
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'check failed: AL booked a shift'; end if;
  update public.shifts set position_role = 'AL' where id = s_booked;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: AL could not edit a booked shift (% rows)', n; end if;
  select status into st from public.shifts where id = s_booked;
  if st is distinct from 'eingetragen' then raise exception 'check failed: booked shift status now %', st; end if;
  update public.app_users set hourly_rate_internal = 99 where id = v_ma;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'check failed: AL changed app_users'; end if;
  ok := false;
  begin
    insert into public.project_folders (name) values ('ZZ RLS folder AL');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'check failed: AL inserted a project folder'; end if;
  insert into public.products (name) values ('ZZ RLS product AL');
  insert into storage.objects (bucket_id, name) values ('product-images', 'zz-rls-al.png');
  ok := false;
  begin
    insert into storage.objects (bucket_id, name) values ('project-files', 'zz-rls-al.txt');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'check failed: AL uploaded to project-files'; end if;
  -- shared phone: the next user takes over the endpoint of the previous one
  perform public.register_push_subscription('zz-rls-endpoint', 'p2', 'a2');
  reset role;
  select user_id into tok from public.push_subscriptions where endpoint = 'zz-rls-endpoint';
  if tok is distinct from v_al then raise exception 'check failed: push endpoint did not move to AL'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.push_subscriptions where endpoint = 'zz-rls-endpoint';
  if n <> 0 then raise exception 'check failed: MA still sees the handed-over push subscription'; end if;
  reset role;

  -- ── PL ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_pl, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.project_folders (name) values ('ZZ RLS folder PL');
  insert into public.plan_weeks (year, kw, week_start, week_end) values (1901, 2, '1901-01-07', '1901-01-13');
  insert into storage.objects (bucket_id, name) values ('project-files', 'zz-rls-pl.txt');
  reset role;

  -- ── Buchhaltung ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_bh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.shifts set status = 'eingetragen' where id = s_open;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: Buchhaltung could not book a shift'; end if;
  select count(*) into n from public.app_user_private;
  if n <> n_private then raise exception 'check failed: Buchhaltung sees % of % private rows', n, n_private; end if;
  update public.app_users set hourly_rate_internal = 21, role_rates = '[]'::jsonb where id = v_ma;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: Buchhaltung could not change rates'; end if;
  update public.app_user_private set hourly_rate_conni = 14 where user_id = v_ma;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: Buchhaltung could not change pay'; end if;
  ok := false;
  begin
    insert into public.plan_weeks (year, kw, week_start, week_end) values (1901, 3, '1901-01-14', '1901-01-20');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'check failed: Buchhaltung uploaded a plan week'; end if;
  reset role;

  -- ── Admin ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.app_users where id = v_del;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: Admin could not delete a user'; end if;
  reset role;

  -- ── service_role (Edge Functions): the booking guard does not apply ──
  -- sub of the AL on purpose: only the service_role claim may skip the guard
  perform set_config('request.jwt.claims', json_build_object('sub', v_al, 'role', 'service_role')::text, true);
  update public.shifts set status = 'offen' where id = s_open;
  update public.shifts set status = 'eingetragen' where id = s_open;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: service_role could not book a shift'; end if;
  perform set_config('request.jwt.claims', '', true);
end $$;
select 'all role checks passed' as result;
