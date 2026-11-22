-- Check of 20261126_app_errors.sql (run after it is applied, or paste the migration above inside one transaction).
-- Always rolls back: the last line raises.
do $$
declare
  u1 uuid; n int; st text; vs text[]; rid uuid; ok boolean;
begin
  select id into u1 from public.app_users where role = 'MA' and is_active is not false order by id limit 1;
  if u1 is null then raise exception 'need one active MA user'; end if;
  delete from public.app_errors where fingerprint like 'zz-check%';
  delete from public.app_error_rate;
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);

  -- rate limit: 25 calls, 20 counted
  for i in 1..25 loop
    perform public.log_error(jsonb_build_object('fingerprint', 'zz-check', 'message', 'm', 'version', 'vA', 'source', 'window'));
  end loop;
  select count, users_affected, versions into n, ok, vs from (select count, users_affected = 1 as users_affected, versions
    from public.app_errors where fingerprint = 'zz-check') s;
  if n <> 20 then raise exception 'rate limit: expected count 20, got %', n; end if;
  if not ok then raise exception 'users_affected should be 1'; end if;
  if vs <> array['vA'] then raise exception 'versions %', vs; end if;

  -- reopen rule
  delete from public.app_error_rate;
  update public.app_errors set status = 'behoben', fixed_in = 'vA' where fingerprint = 'zz-check';
  perform public.log_error(jsonb_build_object('fingerprint', 'zz-check', 'version', 'vA'));
  select status into st from public.app_errors where fingerprint = 'zz-check';
  if st <> 'behoben' then raise exception 'known version must not reopen, got %', st; end if;
  perform public.log_error(jsonb_build_object('fingerprint', 'zz-check', 'version', 'vB'));
  select status, versions into st, vs from public.app_errors where fingerprint = 'zz-check';
  if st <> 'neu' then raise exception 'new version must reopen, got %', st; end if;
  if vs <> array['vA', 'vB'] then raise exception 'versions %', vs; end if;
  update public.app_errors set status = 'ignoriert' where fingerprint = 'zz-check';
  perform public.log_error(jsonb_build_object('fingerprint', 'zz-check', 'version', 'vC'));
  select status into st from public.app_errors where fingerprint = 'zz-check';
  if st <> 'ignoriert' then raise exception 'ignoriert must stay, got %', st; end if;
  select users_affected into n from public.app_errors where fingerprint = 'zz-check';
  if n <> 1 then raise exception 'users_affected %', n; end if;

  -- versions keep the last 10
  for i in 1..12 loop perform public.log_error(jsonb_build_object('fingerprint', 'zz-check', 'version', 'x' || i)); end loop;
  select versions into vs from public.app_errors where fingerprint = 'zz-check';
  if cardinality(vs) <> 10 or vs[10] <> 'x12' then raise exception 'versions cap %', vs; end if;

  -- caps
  delete from public.app_error_rate;
  perform public.log_error(jsonb_build_object('fingerprint', 'zz-check2', 'stack', repeat('s', 10000)));
  select length(stack) into n from public.app_errors where fingerprint = 'zz-check2';
  if n > 4096 then raise exception 'stack not cut: %', n; end if;
  perform public.log_error(jsonb_build_object('message', 'no fingerprint'));

  -- reports
  ok := false;
  begin perform public.report_problem(jsonb_build_object('wanted', ' ', 'happened', ''));
  exception when others then ok := true; end;
  if not ok then raise exception 'empty report must raise'; end if;
  rid := public.report_problem(jsonb_build_object('wanted', repeat('w', 3000), 'happened', 'leer',
                                                   'fingerprints', jsonb_build_array('zz-check')));
  if rid is null then raise exception 'report id null'; end if;
  select length(wanted) into n from public.bug_reports where id = rid;
  if n <> 2000 then raise exception 'wanted not cut: %', n; end if;
  if (select fingerprints from public.bug_reports where id = rid) <> array['zz-check'] then raise exception 'fingerprints'; end if;
  if (select user_id from public.bug_reports where id = rid) <> u1 then raise exception 'user_id'; end if;

  -- logged out (PIN screen)
  perform set_config('request.jwt.claims', '{}', true);
  rid := public.report_problem(jsonb_build_object('happened', 'login geht nicht'));
  if (select user_id from public.bug_reports where id = rid) is not null then raise exception 'anon user_id'; end if;

  -- non-admin sees nothing and cannot insert
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.app_errors;
  if n <> 0 then raise exception 'MA sees % errors', n; end if;
  select count(*) into n from public.bug_reports;
  if n <> 0 then raise exception 'MA sees % reports', n; end if;
  ok := false;
  begin insert into public.app_errors (fingerprint) values ('zz-check3');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'MA could insert'; end if;
  execute 'reset role';

  raise exception 'OK (rolled back)';
end $$;
