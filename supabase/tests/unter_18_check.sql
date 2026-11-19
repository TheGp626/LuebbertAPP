-- Dry run of 20261123_unter_18.sql: paste the migration above this block inside one transaction; always rolls back.
do $$
declare u1 uuid; u2 uuid; n int;
begin
  select id into u1 from public.app_users order by id limit 1;
  select id into u2 from public.app_users order by id offset 1 limit 1;
  delete from public.staff_minors where user_id in (u1, u2);
  insert into public.staff_minors (user_id, birth_date) values
    (u1, ((now() at time zone 'Europe/Berlin')::date - interval '17 years')::date),
    (u2, ((now() at time zone 'Europe/Berlin')::date - interval '18 years')::date); -- 18 today
  if not public.minor_today(null) then raise exception 'no birthday must count as minor'; end if;
  select count(*) into n from public.staff_minors where user_id in (u1, u2) and public.minor_today(birth_date);
  if n <> 1 then raise exception 'expected 1 minor, got %', n; end if;
  delete from public.staff_minors where not public.minor_today(birth_date) and user_id in (u1, u2);
  select count(*) into n from public.staff_minors where user_id in (u1, u2);
  if n <> 1 then raise exception 'cleanup left % rows', n; end if;
  raise exception 'OK (rolled back)';
end $$;
