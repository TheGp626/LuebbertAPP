-- Check of 20261212_bewertungen_intern (run after the migration; always rolls back).
do $$
declare al uuid; ma uuid; ma2 uuid; adm uuid; p uuid; n int; ok boolean;
begin
  select id into al from public.app_users where role = 'AL' and is_active is not false limit 1;
  select id into ma from public.app_users where role = 'MA' and is_active is not false and not coalesce(plan_interest_viewer, false) limit 1;
  select id into ma2 from public.app_users where role = 'MA' and is_active is not false and id <> ma and not coalesce(plan_interest_viewer, false) limit 1;
  select id into adm from public.app_users where role = 'Admin' and is_active is not false limit 1;
  select id into p from public.protocols order by created_at desc limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', al, 'role', 'authenticated')::text, true);
  ok := false;
  begin
    perform public.set_staff_ratings(p, jsonb_build_array(jsonb_build_object('user_id', ma, 'rating', 'down')));
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception '👎 without comment accepted'; end if;
  n := public.set_staff_ratings(p, jsonb_build_array(
    jsonb_build_object('user_id', ma, 'rating', 'star', 'comment', 'leitet gut an'),
    jsonb_build_object('user_id', ma2, 'rating', 'up'),
    jsonb_build_object('user_id', al, 'rating', 'star', 'comment', 'ich selbst')));
  if n <> 2 then raise exception 'expected 2 (no self rating), got %', n; end if;
  n := public.set_staff_ratings(p, jsonb_build_array(jsonb_build_object('user_id', ma2, 'rating', 'up')));
  if (select count(*) from public.staff_ratings where protocol_id = p) <> 1 then raise exception 'list not replaced'; end if;
  -- the rated person does not see it
  perform set_config('request.jwt.claims', json_build_object('sub', ma2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.staff_ratings) then raise exception 'rated MA sees ratings'; end if;
  reset role;
  raise exception 'OK (rolled back)';
end $$;
