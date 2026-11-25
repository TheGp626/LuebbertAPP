-- Check for 20261206_ask_antwort; runs in a transaction that is rolled back.
begin;
do $$
declare v_admin uuid := gen_random_uuid(); v_ma uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); v_id bigint; n int; ok boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.app_users (id, full_name, role, is_active) values (v_admin, 'ZZ AA Anna Admin', 'Admin', true), (v_ma, 'ZZ AA MA', 'MA', true), (v_other, 'ZZ AA Other', 'MA', true);
  insert into public.ask_log (asked_by, user_id, ref, label) values (v_admin, v_ma, 'order:99-0001.01|setup', 'Fr 28.11. 7 Uhr, Estrel, Aufbau') returning id into v_id;

  -- the person sees the ask, answers once, another person cannot answer it
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.answer_ask(v_id, 'ja') is not null then raise exception 'someone else answered'; end if;
  select count(*) into n from public.my_open_asks();
  if n <> 0 then raise exception 'other sees the ask'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.my_open_asks() where label like 'Fr 28.11.%' and asked_by_name = 'ZZ';
  if n <> 1 then raise exception 'own ask not listed: %', n; end if;
  if public.answer_ask(v_id, 'vielleicht') is not null then raise exception 'bad answer accepted'; end if;
  if not public.answer_ask(v_id, 'nein') then raise exception 'answer not stored'; end if;
  if public.answer_ask(v_id, 'ja') is not null then raise exception 'answered twice'; end if;
  select count(*) into n from public.my_open_asks();
  if n <> 0 then raise exception 'answered ask still open'; end if;
  -- an MA does not see answers
  select count(*) into n from public.ask_answers(array['order:99-0001.01|setup']);
  if n <> 0 then raise exception 'MA sees answers'; end if;
  reset role;

  -- the decider sees the Nein
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.ask_answers(array['order:99-0001.01|setup']) where answer = 'nein' and user_id = v_ma;
  if n <> 1 then raise exception 'decider does not see the answer'; end if;
  -- the table itself stays closed
  ok := false; begin perform 1 from public.ask_log; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'authenticated can read ask_log'; end if;
  reset role;
  raise notice 'ask_antwort_check: ok';
end $$;
rollback;
