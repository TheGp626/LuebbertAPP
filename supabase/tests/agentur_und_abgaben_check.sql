-- Check of 20261208_agentur_und_abgaben (run after the migration; always rolls back).
do $$
declare u uuid; v numeric; rr jsonb;
begin
  if (select value -> 'Zenjob' ->> 'Tag' from public.app_settings where key = 'agency_rates') is null then raise exception 'agency_rates missing'; end if;
  begin
    perform public.apply_app_settings('{"agency_rates":{"Zenjob":{"Tag":1}}}'::jsonb, null);
    raise exception 'incomplete agency_rates accepted';
  exception when others then if sqlerrm not like 'invalid_setting%' then raise; end if;
  end;
  begin
    perform public.apply_app_settings('{"employer_charges":{"Minijob":120,"Midijob":22}}'::jsonb, null);
    raise exception 'employer_charges 120 accepted';
  exception when others then if sqlerrm not like 'invalid_setting%' then raise; end if;
  end;

  select id into u from public.app_users order by id limit 1;
  update public.app_users set employment_type = 'Minijob',
    role_rates = '[{"role":"MA Minijob","rate_conni":20,"rate_internal":25},{"role":"AL Fest","rate_conni":0,"rate_internal":0}]' where id = u;
  insert into public.app_user_private (user_id, hourly_rate_conni) values (u, 17)
    on conflict (user_id) do update set hourly_rate_conni = 17;
  perform public.apply_app_settings('{"employer_charges":{"Minijob":30,"Midijob":22}}'::jsonb, null);
  select hourly_rate_internal, role_rates into v, rr from public.app_users where id = u;
  if v <> 22.10 then raise exception 'hourly_rate_internal % <> 22.10', v; end if;
  if (rr -> 0 ->> 'rate_internal')::numeric <> 26 then raise exception 'role rate % <> 26', rr -> 0 ->> 'rate_internal'; end if;
  if (rr -> 1 ->> 'rate_internal')::numeric <> 0 then raise exception 'Fest row changed'; end if;
  raise exception 'OK (rolled back)';
end $$;
