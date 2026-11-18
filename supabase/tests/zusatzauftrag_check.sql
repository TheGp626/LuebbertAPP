-- Assertions for migration zusatzauftrag. Run only inside a transaction that is rolled back (after the migration body).
do $$
declare v_al uuid := gen_random_uuid(); v_main uuid; v_side uuid; ok boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values (v_al, 'ZZ ZA AL', 'AL', true);
  insert into public.protocols (date, action, al_id, total_cost) values ('2099-01-05', 'Aufbau', v_al, 100) returning id into v_main;
  insert into public.protocols (date, action, al_id, total_cost, side_of) values ('2099-01-05', 'Aufbau', v_al, 0, v_main) returning id into v_side;

  -- the main protocol takes shifts, the Zusatz doesn't
  insert into public.shifts (user_id, protocol_id, position_role, shift_date, start_time, end_time, status) select v_al, v_main, 'MA', '2099-01-05', '08:00', '12:00', 'offen';
  ok := false;
  begin insert into public.shifts (user_id, protocol_id, position_role, shift_date, start_time, end_time, status) select v_al, v_side, 'MA', '2099-01-05', '08:00', '12:00', 'offen';
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'Zusatz accepted a shift'; end if;

  ok := false;
  begin update public.protocols set side_of = id where id = v_main; exception when check_violation then ok := true; end;
  if not ok then raise exception 'protocol could point at itself'; end if;

  -- deleting the main protocol leaves the Zusatz as a normal one
  delete from public.shifts where protocol_id = v_main;
  delete from public.protocols where id = v_main;
  if (select side_of from public.protocols where id = v_side) is not null then raise exception 'side_of not cleared'; end if;
  raise notice 'zusatzauftrag_check: ok';
end $$;
