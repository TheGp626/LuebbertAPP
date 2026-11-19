-- Verdienst-Balken: a rate entry of the same function also applies to shifts stored with another type (an old
-- "MA Minijob" shift after the person became Midijob gets their "MA Midijob" rate). Order: exact role, old
-- "MA frei"/"MA fest" entry, any entry of the function. Same as personRoleRate in js/formulas.js.
-- Rollback: supabase/rollback/20261122_lohn_gleiche_funktion_rollback.sql (= 20261121_lohn_pro_funktion).
-- Check: supabase/tests/lohn_gleiche_funktion_check.sql.
create or replace function public.income_shares(p_ids uuid[], p_from date, p_to date, p_year_from date, p_past_months integer)
returns table (user_id uuid, pct integer, hours numeric, ahead integer, has_limit boolean, has_rate boolean)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select (select (value #>> '{}')::numeric from public.app_settings where key = 'income_limit_minijob') as mini,
           (select (value #>> '{}')::numeric from public.app_settings where key = 'income_limit_midijob') as midi
  ), u as (
    select a.id, a.role_rates, nullif(pr.hourly_rate_conni, 0) as base,
      coalesce(nullif(pr.income_limit, 0),
        case coalesce(a.employment_type, case when a.is_fest then 'Fest' else 'Minijob' end)
          when 'Minijob' then cfg.mini when 'Midijob' then cfg.midi end) as lim
    from public.app_users a cross join cfg left join public.app_user_private pr on pr.user_id = a.id
    where a.id = any (coalesce(p_ids, '{}'))
  ), s as (
    select sh.user_id, coalesce(sh.shift_date, p.date, sh.created_at::date) as d,
      greatest(180, (extract(epoch from (sh.end_time - sh.start_time)) / 60)::int
        + case when sh.end_time < sh.start_time then 1440 else 0 end - coalesce(sh.pause_mins, 0)) as mins,
      coalesce((
        select (r ->> 'rate_conni')::numeric
          from jsonb_array_elements(case when jsonb_typeof(u.role_rates) = 'array' then u.role_rates else '[]'::jsonb end) r
         where jsonb_typeof(r -> 'rate_conni') = 'number' and (r ->> 'rate_conni')::numeric > 0
           and split_part(r ->> 'role', ' ', 1) = split_part(sh.position_role, ' ', 1)
         order by (r ->> 'role' = sh.position_role) desc,
           ((split_part(r ->> 'role', ' ', 2) = 'frei' and split_part(sh.position_role, ' ', 2) in ('Minijob', 'Midijob', 'Rechnung'))
             or (split_part(r ->> 'role', ' ', 2) = 'fest' and split_part(sh.position_role, ' ', 2) = 'Fest')) desc
         limit 1), u.base) as rate
    from public.shifts sh join u on u.id = sh.user_id left join public.protocols p on p.id = sh.protocol_id
    where sh.start_time is not null and sh.end_time is not null
  ), t as (
    select u.id, u.lim,
      bool_or(s.rate is not null) or u.base is not null
        or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(u.role_rates) = 'array' then u.role_rates else '[]'::jsonb end) r
                    where jsonb_typeof(r -> 'rate_conni') = 'number' and (r ->> 'rate_conni')::numeric > 0) as rated,
      coalesce(sum(s.mins) filter (where s.d between p_from and p_to), 0) as cur_mins,
      coalesce(sum(s.mins / 60.0 * coalesce(s.rate, 0)) filter (where s.d between p_from and p_to), 0) as cur_pay,
      coalesce(sum(s.mins / 60.0 * coalesce(s.rate, 0)) filter (where s.d >= p_year_from and s.d < p_from), 0) as past_pay
    from u left join s on s.user_id = u.id group by u.id, u.lim, u.base, u.role_rates
  )
  select t.id,
    case when not t.rated or not t.lim > 0 then null else round(t.cur_pay / t.lim * 100)::int end,
    round(t.cur_mins / 60.0, 1),
    case when not t.rated or not t.lim > 0 then 0
      else greatest(0, floor((t.past_pay - t.lim * greatest(p_past_months, 0)) / t.lim))::int end,
    t.lim > 0, t.rated
  from t
  where (select public.sees_plan_interest());
$$;
revoke all on function public.income_shares(uuid[], date, date, date, integer) from public, anon;
grant execute on function public.income_shares(uuid[], date, date, date, integer) to authenticated;
