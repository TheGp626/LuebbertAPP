-- Assertions for migration shift_overlap_guard. Run only inside a transaction that is rolled back (after the migration body).
do $$
declare v_u uuid := gen_random_uuid(); p1 uuid; p2 uuid; ok boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values (v_u, 'ZZ OV User', 'MA', true);
  insert into public.protocols (date, action, total_cost) values ('2099-01-05', 'Aufbau', 0) returning id into p1;
  insert into public.protocols (date, action, total_cost) values ('2099-01-05', 'Abbau', 0) returning id into p2;
  insert into public.shifts (user_id, protocol_id, position_role, shift_date, start_time, end_time, status) values (v_u, p1, 'MA', '2099-01-05', '10:00', '13:00', 'offen');

  -- same protocol, other person's row, back-to-back handover and a temp worker are fine
  insert into public.shifts (user_id, protocol_id, position_role, shift_date, start_time, end_time, status) values (v_u, p2, 'MA', '2099-01-05', '13:00', '15:00', 'offen');
  insert into public.shifts (temp_worker_name, protocol_id, position_role, shift_date, start_time, end_time, status) values ('Aushilfe', p2, 'MA', '2099-01-05', '10:00', '13:00', 'offen');

  -- overlap with another protocol is rejected (insert and update)
  ok := false;
  begin insert into public.shifts (user_id, protocol_id, position_role, shift_date, start_time, end_time, status) values (v_u, p2, 'MA', '2099-01-05', '12:00', '14:00', 'offen');
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'overlapping shift accepted'; end if;
  ok := false;
  begin update public.shifts set start_time = '12:00' where protocol_id = p2 and user_id = v_u;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'overlapping update accepted'; end if;
  raise notice 'shift_overlap_check: ok';
end $$;
