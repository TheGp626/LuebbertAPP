-- Assertions for migration 20261108_meldungen. Run only inside a transaction that is rolled back.
do $$
declare
  v_ma uuid := gen_random_uuid();
  v_pl uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_week uuid := gen_random_uuid();
  n integer;
  ok boolean;
  st text;
  who uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values (v_ma, 'ZZ MEL MA', 'MA', true), (v_pl, 'ZZ MEL PL', 'PL', true);
  insert into public.app_users (id, full_name, role, is_active, plan_interest_viewer) values (v_viewer, 'ZZ MEL Viewer', 'AL', true, true);
  insert into public.plan_weeks (id, year, kw, week_start, week_end) values (v_week, 1999, 1, '1999-01-04', '1999-01-10');
  insert into public.plan_shifts (week_id, date, key, open_slots) values
    (v_week, '1999-01-04', 'k1', '[{"role":"MA","count":1}]'), (v_week, '1999-01-04', 'k2', '[{"role":"MA","count":1}]'),
    (v_week, '1999-01-04', 'k3', '[{"role":"MA","count":1}]'), (v_week, '1999-01-04', 'k4', '[{"role":"MA","count":1}]'), (v_week, '1999-01-04', 'k5', '[{"role":"MA","count":1}]');
  insert into public.order_staffing (job_no, staff_setup) values ('99-9999.01', 2);
  -- PL's own rows (to prove an unflagged PL sees only own rows)
  insert into public.plan_shift_interest (week_id, shift_key, user_id) values (v_week, 'k3', v_pl);
  insert into public.order_applications (job_no, phase, user_id) values ('99-9999.01', 'teardown', v_pl);
  insert into public.plan_shift_interest (week_id, shift_key, user_id, status) values (v_week, 'k4', v_ma, 'abgelehnt');

  -- MA: insert only 'offen', decided_* not forgeable, no update, delete only own 'offen'
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin insert into public.plan_shift_interest (week_id, shift_key, user_id, status) values (v_week, 'k1', v_ma, 'angenommen');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: MA inserted an accepted interest'; end if;
  insert into public.plan_shift_interest (week_id, shift_key, user_id, decided_by) values (v_week, 'k1', v_ma, v_ma);
  insert into public.plan_shift_interest (week_id, shift_key, user_id) values (v_week, 'k2', v_ma);
  select status, decided_by into st, who from public.plan_shift_interest where week_id = v_week and shift_key = 'k1' and user_id = v_ma;
  if st <> 'offen' or who is not null then raise exception 'check failed: new interest is % / decided_by %', st, who; end if;
  update public.plan_shift_interest set status = 'angenommen' where user_id = v_ma;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'check failed: MA updated % own rows', n; end if;
  insert into public.order_applications (job_no, phase, user_id) values ('99-9999.01', 'setup', v_ma);
  reset role;

  -- Viewer (AL with the switch): sees and decides both tables, reads order_staffing
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.plan_shift_interest set status = 'angenommen' where week_id = v_week and shift_key = 'k1' and user_id = v_ma;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: viewer decided % interest rows', n; end if;
  select decided_by into who from public.plan_shift_interest where week_id = v_week and shift_key = 'k1' and user_id = v_ma;
  if who is distinct from v_viewer then raise exception 'check failed: decided_by is %', who; end if;
  update public.order_applications set status = 'angenommen' where job_no = '99-9999.01' and phase = 'setup' and user_id = v_ma;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: viewer decided % order rows', n; end if;
  select count(*) into n from public.order_staffing where job_no = '99-9999.01';
  if n <> 1 then raise exception 'check failed: viewer sees % order_staffing rows', n; end if;
  -- the live client lists every interest row a viewer can read as "Hätten Zeit": rejected ones stay hidden
  select count(*) into n from public.plan_shift_interest where week_id = v_week and shift_key = 'k4';
  if n <> 0 then raise exception 'check failed: viewer sees a rejected interest'; end if;
  -- rejecting reads the row back (client .select()) → must work for the one who rejects
  with u as (update public.plan_shift_interest set status = 'abgelehnt' where week_id = v_week and shift_key = 'k3' returning user_id) select count(*) into n from u;
  if n <> 1 then raise exception 'check failed: viewer reject with returning gave % rows', n; end if;
  -- direct accept from „Hätten laut Verfügbarkeit Zeit“: accepted row for someone else, decided_by from the server
  with i as (insert into public.plan_shift_interest (week_id, shift_key, user_id, status) values (v_week, 'k5', v_ma, 'angenommen') returning decided_by) select decided_by into who from i;
  if who is distinct from v_viewer then raise exception 'check failed: direct accept decided_by is %', who; end if;
  insert into public.order_applications (job_no, phase, user_id, status) values ('99-9999.02', 'setup', v_ma, 'angenommen');
  ok := false;
  begin insert into public.plan_shift_interest (week_id, shift_key, user_id) values (v_week, 'k5', v_pl);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: viewer inserted an open Meldung for someone else'; end if;
  reset role;

  -- MA again: own accepted row cannot be deleted, own open row can
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.plan_shift_interest where week_id = v_week and shift_key = 'k1' and user_id = v_ma;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'check failed: MA deleted an accepted interest'; end if;
  delete from public.plan_shift_interest where week_id = v_week and shift_key = 'k2' and user_id = v_ma;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check failed: MA could not withdraw an open interest'; end if;
  select count(*) into n from public.plan_shift_interest where week_id = v_week and shift_key = 'k4' and user_id = v_ma;
  if n <> 1 then raise exception 'check failed: MA does not see own rejected interest'; end if;
  reset role;

  -- PL without the switch: only own rows, cannot decide
  perform set_config('request.jwt.claims', json_build_object('sub', v_pl, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.plan_shift_interest where week_id = v_week;
  if n <> 1 then raise exception 'check failed: unflagged PL sees % interest rows, expected 1', n; end if;
  select count(*) into n from public.order_applications where job_no = '99-9999.01';
  if n <> 1 then raise exception 'check failed: unflagged PL sees % order rows, expected 1', n; end if;
  update public.order_applications set status = 'abgelehnt' where job_no = '99-9999.01';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'check failed: unflagged PL decided % order rows', n; end if;
  ok := false;
  begin insert into public.order_applications (job_no, phase, user_id, status) values ('99-9999.03', 'setup', v_ma, 'angenommen');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: unflagged PL accepted for someone else'; end if;
  select count(*) into n from public.order_staffing where job_no = '99-9999.01';
  if n <> 1 then raise exception 'check failed: PL lost order_staffing read'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  select count(*) into n from pg_policies where tablename = 'order_parsed' and policyname = 'rls_order_parsed_select' and qual like '%sees_plan_interest%';
  if n <> 1 then raise exception 'check failed: order_parsed select does not include the viewer'; end if;
end $$;
select 'all meldungen checks passed' as result;
