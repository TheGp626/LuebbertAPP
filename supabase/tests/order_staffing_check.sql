-- Assertions for migration order_staffing. Run only inside a transaction that is rolled back (after the migration body);
-- raises on the first failed check. Temporary users 'ZZ OS …' disappear with the rollback.
do $$
declare
  v_pl uuid := gen_random_uuid();
  v_ma uuid := gen_random_uuid();
  n int; ok boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values
    (v_pl, 'ZZ OS PL', 'PL', true), (v_ma, 'ZZ OS MA', 'MA', true);

  -- ── PL writes and reads ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_pl, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.order_staffing (job_no, staff_setup) values ('99-9999.01', 4);
  insert into public.order_staffing (job_no, staff_setup, staff_teardown) values ('99-9999.01', 5, 2)
    on conflict (job_no) do update set staff_setup = excluded.staff_setup, staff_teardown = excluded.staff_teardown;
  select count(*) into n from public.order_staffing where job_no = '99-9999.01' and staff_setup = 5 and updated_by = v_pl;
  if n <> 1 then raise exception 'PL upsert failed'; end if;
  ok := false; begin insert into public.order_staffing (job_no, staff_setup) values ('99-9999.02', 100);
  exception when check_violation then ok := true; end;
  if not ok then raise exception '100 accepted'; end if;
  ok := false; begin insert into public.order_staffing (job_no) values ('kein-job');
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'bad job_no accepted'; end if;

  -- ── MA sees nothing, writes nothing ──
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.order_staffing;
  if n <> 0 then raise exception 'MA can read'; end if;
  ok := false; begin insert into public.order_staffing (job_no, staff_setup) values ('99-9999.03', 1);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA can write'; end if;
  reset role;
  raise notice 'order_staffing checks passed';
end $$;
