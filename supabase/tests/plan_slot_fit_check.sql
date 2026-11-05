-- Assertions for migration plan_interest_slot_fit. Run only inside a transaction that is rolled back.
do $$
declare
  v_ma uuid := gen_random_uuid();
  v_driver uuid := gen_random_uuid();
  v_al uuid := gen_random_uuid();
  v_week uuid := gen_random_uuid();
  ok boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active, can_drive) values
    (v_ma, 'ZZ FIT MA', 'MA', true, false), (v_driver, 'ZZ FIT Driver', 'MA', true, true), (v_al, 'ZZ FIT AL', 'AL', true, false);
  insert into public.plan_weeks (id, year, kw, week_start, week_end) values (v_week, 1999, 2, '1999-01-11', '1999-01-17');
  insert into public.plan_shifts (week_id, date, key, open_slots) values
    (v_week, '1999-01-11', 'fahrer', '[{"role":"Fahrer","count":1}]'),
    (v_week, '1999-01-11', 'al', '[{"role":"AL","count":1}]'),
    (v_week, '1999-01-11', 'ma', '[{"role":"MA","count":2}]'),
    (v_week, '1999-01-11', 'zenjob', '[{"role":"Zenjob","count":3}]'),
    (v_week, '1999-01-11', 'full', '[]');

  -- plain MA: MA and agency slots yes; Fahrer, AL and full shifts no
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.plan_shift_interest (week_id, shift_key, user_id) values (v_week, 'ma', v_ma), (v_week, 'zenjob', v_ma);
  ok := false; begin insert into public.plan_shift_interest values (v_week, 'fahrer', v_ma);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: MA applied for a Fahrer slot'; end if;
  ok := false; begin insert into public.plan_shift_interest values (v_week, 'al', v_ma);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: MA applied for an AL slot'; end if;
  ok := false; begin insert into public.plan_shift_interest values (v_week, 'full', v_ma);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: MA applied for a shift without open slots'; end if;
  reset role;

  -- MA who can drive: Fahrer slot yes
  perform set_config('request.jwt.claims', json_build_object('sub', v_driver, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.plan_shift_interest (week_id, shift_key, user_id) values (v_week, 'fahrer', v_driver);
  reset role;

  -- AL: AL and MA slots yes, Fahrer no (cannot drive)
  perform set_config('request.jwt.claims', json_build_object('sub', v_al, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.plan_shift_interest (week_id, shift_key, user_id) values (v_week, 'al', v_al), (v_week, 'ma', v_al);
  ok := false; begin insert into public.plan_shift_interest values (v_week, 'fahrer', v_al);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'check failed: AL without can_drive applied for a Fahrer slot'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;
select 'all plan_slot_fit checks passed' as result;
