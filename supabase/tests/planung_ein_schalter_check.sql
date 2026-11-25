-- Assertions for migration planung_ein_schalter. Run only inside a transaction that is rolled back (after the migration body).
do $$
declare v_admin uuid := gen_random_uuid(); v_pl uuid := gen_random_uuid(); v_ma uuid := gen_random_uuid(); ok boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  if exists (select 1 from public.app_users where plans_week is distinct from plan_interest_viewer) then raise exception 'switches differ after merge'; end if;
  insert into public.app_users (id, full_name, role, is_active, plan_interest_viewer) values (v_admin, 'ZZ PS Admin', 'Admin', true, false), (v_pl, 'ZZ PS PL', 'PL', true, false), (v_ma, 'ZZ PS MA', 'MA', true, true);
  if not (select plans_week from public.app_users where id = v_ma) then raise exception 'insert not synced'; end if;

  -- Admin switches one column, the other follows
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  update public.app_users set plan_interest_viewer = true where id = v_pl;
  if not (select plans_week from public.app_users where id = v_pl) then raise exception 'plans_week did not follow'; end if;
  update public.app_users set plans_week = false where id = v_pl;
  if (select plan_interest_viewer from public.app_users where id = v_pl) then raise exception 'plan_interest_viewer did not follow'; end if;

  -- a PL cannot switch it on (for themselves or anyone), but can still save other fields
  perform set_config('request.jwt.claims', json_build_object('sub', v_pl, 'role', 'authenticated')::text, true);
  ok := false; begin update public.app_users set plan_interest_viewer = true where id = v_pl;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'PL could switch on Planung'; end if;
  update public.app_users set can_drive = true where id = v_ma;
  raise notice 'planung_ein_schalter_check: ok';
end $$;
