-- ---------------------------------------------------------------------------
-- Queue scoring · "Is it working?" over the last 14 days, not only since the beginning
--
-- `tenant_scoring_cohort_stats` (20260913390000) is all-time: one row per cohort since the first
-- serve ever recorded. The concept board (LA-2 §13) reads the comparison over "last 14 days", and
-- the user chose a 14-day default with an all-time toggle. An all-time figure also hides a change
-- of weights: the arm totals keep the dials served under the old weights for as long as the tenant
-- exists.
--
-- `tenant_scoring_cohort_stats_since(tenant, from)` is the same aggregate with a lower bound on
-- served_at. `p_from` null is all-time and returns exactly what the view returns for the two
-- experiment arms. The 'picked' cohort (a lead an agent chose by hand, 20260924323100) is left out
-- on purpose: it is on neither side of the holdout comparison.
--
-- Read-only, STABLE. The index tenant_scoring_decisions_tenant_served_idx (tenant_id, served_at
-- desc) already serves the range.
-- ---------------------------------------------------------------------------

create or replace function public.tenant_scoring_cohort_stats_since(
  p_tenant_id uuid,
  p_from timestamptz default null
)
returns table(
  cohort text,
  served bigint,
  contacted bigint,
  contact_rate_pct numeric,
  average_score numeric,
  since timestamptz
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select d.cohort,
         count(*) as served,
         count(d.contacted_at) as contacted,
         case when count(*) > 0
              then round(100.0 * count(d.contacted_at) / count(*), 1) end as contact_rate_pct,
         round(avg(d.score), 2) as average_score,
         min(d.served_at) as since
    from public.tenant_scoring_decisions d
   where d.tenant_id = p_tenant_id
     and d.cohort in ('scored', 'control')
     and (p_from is null or d.served_at >= p_from)
   group by d.cohort;
$function$;

revoke all on function public.tenant_scoring_cohort_stats_since(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.tenant_scoring_cohort_stats_since(uuid, timestamptz) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_mismatch integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925701000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.tenant_scoring_cohort_stats_since(uuid, timestamp with time zone)') is null then
    raise exception '20260925701000: tenant_scoring_cohort_stats_since is missing';
  end if;
  if not has_function_privilege('tenant_app', 'public.tenant_scoring_cohort_stats_since(uuid, timestamp with time zone)', 'execute') then
    raise exception '20260925701000: tenant_app cannot execute tenant_scoring_cohort_stats_since';
  end if;

  -- All-time must be the view, arm for arm, for the tenant with the most decisions.
  select d.tenant_id into v_tenant
    from public.tenant_scoring_decisions d
   group by d.tenant_id order by count(*) desc limit 1;
  if v_tenant is null then
    raise notice '20260925701000: no scoring decisions yet; the comparison with the view was skipped';
    return;
  end if;

  select count(*) into v_mismatch
    from (select s.cohort, s.served, s.contacted
            from public.tenant_scoring_cohort_stats s
           where s.tenant_id = v_tenant and s.cohort in ('scored', 'control')) v
    full join public.tenant_scoring_cohort_stats_since(v_tenant, null) f on f.cohort = v.cohort
   where v.served is distinct from f.served or v.contacted is distinct from f.contacted;
  if v_mismatch > 0 then
    raise exception '20260925701000: all-time cohort stats differ from tenant_scoring_cohort_stats (% arms)', v_mismatch;
  end if;

  raise notice '20260925701000: tenant_scoring_cohort_stats_since matches the all-time view';
end $$;
