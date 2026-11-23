-- Check of 20261128_plan_symbols.sql (run after it is applied). Always rolls back: the last line raises.
do $$
declare al uuid; ma uuid; n int; failed boolean;
begin
  select id into al from public.app_users where role = 'AL' and is_active is not false order by id limit 1;
  select id into ma from public.app_users where role = 'MA' and is_active is not false order by id limit 1;
  if al is null or ma is null then raise exception 'need one active AL and one MA'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', al, 'role', 'authenticated')::text, true);
  insert into public.plan_symbols (sig, name) values ('p4|-|#000000|48.0|108.0', 'Stuhl');
  update public.plan_symbols set name = 'Stuhl schwarz' where sig = 'p4|-|#000000|48.0|108.0';
  perform set_config('request.jwt.claims', json_build_object('sub', ma, 'role', 'authenticated')::text, true);
  select count(*) into n from public.plan_symbols where sig = 'p4|-|#000000|48.0|108.0';
  if n <> 1 then raise exception 'MA must read the names'; end if;
  failed := false;
  begin insert into public.plan_symbols (sig, name) values ('x|y|z|1|1', 'nope'); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'MA must not write'; end if;
  raise exception 'ALL CHECKS PASSED (rolled back)';
end $$;
