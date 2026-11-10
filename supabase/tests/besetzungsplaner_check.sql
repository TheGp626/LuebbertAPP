-- Assertions for migration besetzungsplaner. Run only inside a transaction that is rolled back (after the migration body);
-- raises on the first failed check. Temporary users 'ZZ BP …' and week 2099/1 disappear with the rollback.
do $$
declare
  v_ma uuid := gen_random_uuid();    -- MA without the switch
  v_plan uuid := gen_random_uuid();  -- MA with "Plant den Wochenplan"
  v_pl uuid := gen_random_uuid();    -- PL without the switch
  v_pl2 uuid := gen_random_uuid();   -- another PL
  v_admin uuid := gen_random_uuid();
  v_row uuid; v_free uuid; v_week uuid;
  n int; ok boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active, plans_week) values
    (v_ma, 'ZZ BP MA', 'MA', true, false), (v_plan, 'ZZ BP Planer', 'MA', true, true),
    (v_pl, 'ZZ BP PL', 'PL', true, false), (v_pl2, 'ZZ BP PL2', 'PL', true, false), (v_admin, 'ZZ BP Admin', 'Admin', true, false);

  -- ── Planner (MA with the switch) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_plan, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.plans_week() then raise exception 'planner: plans_week() is false'; end if;
  insert into public.plan_draft_weeks (year, kw, week_start, week_end) values (2099, 1, '2098-12-29', '2099-01-04');
  insert into public.plan_draft_shifts (year, kw, date, venue, title) values (2099, 1, '2098-12-29', 'ZZ Ort', 'frei') returning id into v_free;
  insert into public.plan_draft_shifts (year, kw, date, job_no, phase, venue, ap_user_id)
    values (2099, 1, '2098-12-30', '99-0001.01', 'teardown', 'ZZ Ort', v_pl2);
  select updated_by into v_row from public.plan_draft_shifts where id = v_free;
  if v_row is distinct from v_plan then raise exception 'updated_by not set by the server'; end if;
  -- publishing: the plan tables accept a planner without the PL role
  insert into public.plan_weeks (year, kw, week_start, week_end) values (2099, 1, '2098-12-29', '2099-01-04') returning id into v_week;
  insert into public.plan_shifts (week_id, date, key) values (v_week, '2098-12-29', 'zz|bp') returning id into v_row;
  insert into public.plan_assignments (shift_id, name) values (v_row, 'ZZ');
  update public.plan_weeks set version = version + 1 where id = v_week;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'planner could not bump the week version'; end if;
  delete from public.plan_shifts where id = v_row;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'planner could not delete an old plan shift'; end if;
  update public.plan_draft_weeks set published_version = 2 where year = 2099 and kw = 1;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'planner could not mark the draft published'; end if;
  reset role;

  -- ── PL without the switch ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_pl, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.plans_week() then raise exception 'PL counts as planner without the switch'; end if;
  select count(*) into n from public.plan_draft_shifts where year = 2099;
  if n <> 2 then raise exception 'PL reads % draft rows, expected 2', n; end if;
  insert into public.plan_draft_shifts (year, kw, date, job_no, phase, venue) values (2099, 1, '2098-12-29', '99-0001.01', 'setup', 'ZZ Ort') returning id into v_row;
  update public.plan_draft_shifts set ap_user_id = v_pl, need = 3 where id = v_row;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'PL could not claim an Auftrag row'; end if;
  ok := false; begin insert into public.plan_draft_shifts (year, kw, date, venue) values (2099, 1, '2098-12-29', 'ZZ frei');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'PL inserted a free row'; end if;
  update public.plan_draft_shifts set need = 9 where id = v_free;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'PL edited a free row'; end if;
  update public.plan_draft_shifts set need = 9 where job_no = '99-0001.01' and phase = 'teardown';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'PL edited the row of another AP'; end if;
  ok := false; begin update public.plan_draft_shifts set ap_user_id = v_pl2 where id = v_row;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'PL handed a row to another AP'; end if;
  delete from public.plan_draft_shifts where id = v_row;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'PL deleted a draft row'; end if;
  update public.plan_draft_weeks set published_version = 9 where year = 2099;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'PL marked a draft published'; end if;
  ok := false; begin update public.app_users set plans_week = true where id = v_pl;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'PL switched themselves on'; end if;
  reset role;

  -- ── MA without the switch ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.plan_draft_shifts;
  if n <> 0 then raise exception 'MA reads % draft rows', n; end if;
  select count(*) into n from public.plan_draft_weeks;
  if n <> 0 then raise exception 'MA reads % draft weeks', n; end if;
  ok := false; begin insert into public.plan_draft_weeks (year, kw, week_start, week_end) values (2099, 2, '2099-01-05', '2099-01-11');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA created a draft week'; end if;
  ok := false; begin insert into public.plan_shifts (week_id, date, key) values (v_week, '2098-12-29', 'zz|ma');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA wrote the published plan'; end if;
  reset role;

  -- ── Admin ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.plans_week() then raise exception 'Admin is no planner'; end if;
  update public.app_users set plans_week = true where id = v_pl;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Admin could not set the switch'; end if;
  delete from public.plan_draft_weeks where year = 2099;
  select count(*) into n from public.plan_draft_shifts where year = 2099;
  if n <> 0 then raise exception 'draft rows survived their week'; end if;
  reset role;

  raise notice 'besetzungsplaner_check: ok';
end $$;
