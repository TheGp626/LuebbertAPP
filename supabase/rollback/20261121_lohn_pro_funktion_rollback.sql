-- Rollback of 20261121_lohn_pro_funktion: income_shares as in 20261120_mitarbeiter_pflegen (one pay rate per person).
create or replace function public.income_shares(p_ids uuid[], p_from date, p_to date, p_year_from date, p_past_months integer)
returns table (user_id uuid, pct integer, hours numeric, ahead integer, has_limit boolean, has_rate boolean)
language sql stable security definer set search_path = public as $$
  with s as (
    select sh.user_id, coalesce(sh.shift_date, p.date, sh.created_at::date) as d,
      greatest(180, (extract(epoch from (sh.end_time - sh.start_time)) / 60)::int
        + case when sh.end_time < sh.start_time then 1440 else 0 end - coalesce(sh.pause_mins, 0)) as mins
    from public.shifts sh left join public.protocols p on p.id = sh.protocol_id
    where sh.user_id = any (coalesce(p_ids, '{}')) and sh.start_time is not null and sh.end_time is not null
  ), cfg as (
    select (select (value #>> '{}')::numeric from public.app_settings where key = 'income_limit_minijob') as mini,
           (select (value #>> '{}')::numeric from public.app_settings where key = 'income_limit_midijob') as midi
  ), u as (
    select a.id, nullif(pr.hourly_rate_conni, 0) as rate,
      coalesce(nullif(pr.income_limit, 0),
        case coalesce(a.employment_type, case when a.is_fest then 'Fest' else 'Minijob' end)
          when 'Minijob' then cfg.mini when 'Midijob' then cfg.midi end) as lim
    from public.app_users a cross join cfg left join public.app_user_private pr on pr.user_id = a.id
    where a.id = any (coalesce(p_ids, '{}'))
  ), t as (
    select u.id, u.rate, u.lim,
      coalesce(sum(s.mins) filter (where s.d between p_from and p_to), 0) as cur_mins,
      coalesce(sum(s.mins) filter (where s.d >= p_year_from and s.d < p_from), 0) as past_mins
    from u left join s on s.user_id = u.id group by u.id, u.rate, u.lim
  )
  select t.id,
    case when t.rate is null or not t.lim > 0 then null else round(t.cur_mins / 60.0 * t.rate / t.lim * 100)::int end,
    round(t.cur_mins / 60.0, 1),
    case when t.rate is null or not t.lim > 0 then 0
      else greatest(0, floor((t.past_mins / 60.0 * t.rate - t.lim * greatest(p_past_months, 0)) / t.lim))::int end,
    t.lim > 0, t.rate is not null
  from t
  where (select public.sees_plan_interest());
$$;
revoke all on function public.income_shares(uuid[], date, date, date, integer) from public, anon;
grant execute on function public.income_shares(uuid[], date, date, date, integer) to authenticated;
