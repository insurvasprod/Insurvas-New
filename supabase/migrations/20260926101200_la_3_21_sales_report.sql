-- LA-3 step 24 — the sales report (LA-3.21).
--
-- docs/la3/SCHEMA-PLAN.md "Step 24" is the specification. In short:
--
--   mv_la3_funnel               MATVIEW  per tenant, local day, carrier, product, case source, campaign,
--                                        producer: quoted leads, attempts reaching ready, submitted, issued
--   mv_la3_declines             MATVIEW  per tenant, local day, carrier, outcome, reason code: closed attempts
--                                        that did not issue
--   mv_la3_counteroffers        MATVIEW  per tenant, local day, carrier, status: counteroffers received
--   la3_sales_report()          NEW      security definer reader, filtered by tenant; service_role only
--   la3_refresh_sales_report()  NEW      refreshes all three concurrently; service_role only
--
-- Materialised views cannot carry RLS, so they are revoked from tenant_app, anon and authenticated
-- and read only through la3_sales_report(), which filters on the tenant it is given. Each view has a
-- plain unique index over its grouping columns (NULLS NOT DISTINCT, PostgreSQL 15+) so it can be
-- refreshed concurrently. Scheduling the refresh (pg_cron, with the check block that runs the job
-- once — memory: pg_cron jobs fail silently) is left to the step that turns the report on;
-- mv_la3_timing is not built yet.
--
-- Counting rules, stated because the data has no status history:
--   · "local day" is the tenant's agency_profiles.timezone when it is a real zone name, else UTC;
--   · a quoted lead counts once, on the day and against the carrier / product / producer of its
--     FIRST quote, so a day's or a carrier's counts add up to the tenant's total exactly;
--   · "reached ready" is inferred — nothing records the moment an attempt became ready. An attempt
--     counts if it is ready or later, or was ever submitted, on its submission day (or, while it is
--     still ready, the day it was last updated). An attempt that was ready and then withdrawn
--     without submitting is not counted;
--   · the producer is the user who created the quote or the attempt;
--   · "placed" (first draft collected) is NOT computed: no first-draft result exists anywhere yet.
--     la3_sales_report returns placed = null and lists it under `partial`.
--
-- Down:
--   drop function public.la3_sales_report(uuid, date, date), public.la3_refresh_sales_report();
--   drop materialized view public.mv_la3_counteroffers, public.mv_la3_declines, public.mv_la3_funnel;

-- ── 1 · funnel ──────────────────────────────────────────────────────────────
create materialized view if not exists public.mv_la3_funnel as
with tz as (
  select t.id as tenant_id, coalesce(z.name, 'UTC') as tz
    from public.tenants t
    left join public.agency_profiles ap on ap.tenant_id = t.id
    left join pg_catalog.pg_timezone_names z on z.name = ap.timezone
),
first_quote as (
  select distinct on (q.tenant_id, q.lead_id)
         q.tenant_id, q.case_id, q.carrier_id, q.product_code, q.created_by as producer_id, q.created_at as at
    from public.tenant_quotes q
   order by q.tenant_id, q.lead_id, q.created_at, q.id
),
events as (
  select fq.tenant_id, fq.at, fq.carrier_id, fq.product_code, fq.case_id, fq.producer_id,
         1 as quoted, 0 as ready, 0 as submitted, 0 as issued
    from first_quote fq
  union all
  select a.tenant_id, coalesce(a.submitted_at, a.updated_at), a.carrier_id, a.product_code, a.case_id, a.created_by,
         0, 1, 0, 0
    from public.tenant_applications a
   where a.submitted_at is not null
      or a.status in ('ready', 'submitted', 'pending_carrier', 'counteroffer_pending')
  union all
  select a.tenant_id, a.submitted_at, a.carrier_id, a.product_code, a.case_id, a.created_by,
         0, 0, 1, 0
    from public.tenant_applications a
   where a.submitted_at is not null
  union all
  select a.tenant_id, a.outcome_recorded_at, a.carrier_id, a.product_code, a.case_id, a.created_by,
         0, 0, 0, 1
    from public.tenant_applications a
   where a.status = 'closed' and a.outcome = 'issued' and a.outcome_recorded_at is not null
)
select e.tenant_id,
       (e.at at time zone tz.tz)::date as day,
       e.carrier_id,
       e.product_code,
       c.source as case_source,
       c.campaign_id,
       e.producer_id,
       sum(e.quoted)::bigint as quoted_leads,
       sum(e.ready)::bigint as reached_ready,
       sum(e.submitted)::bigint as submitted,
       sum(e.issued)::bigint as issued
  from events e
  join tz on tz.tenant_id = e.tenant_id
  join public.tenant_application_cases c on c.id = e.case_id
 group by e.tenant_id, (e.at at time zone tz.tz)::date, e.carrier_id, e.product_code, c.source, c.campaign_id, e.producer_id
with data;

create unique index if not exists mv_la3_funnel_key
  on public.mv_la3_funnel (tenant_id, day, carrier_id, product_code, case_source, campaign_id, producer_id) nulls not distinct;

-- ── 2 · declines (every closed attempt that did not issue) ──────────────────
create materialized view if not exists public.mv_la3_declines as
with tz as (
  select t.id as tenant_id, coalesce(z.name, 'UTC') as tz
    from public.tenants t
    left join public.agency_profiles ap on ap.tenant_id = t.id
    left join pg_catalog.pg_timezone_names z on z.name = ap.timezone
)
select a.tenant_id,
       (a.outcome_recorded_at at time zone tz.tz)::date as day,
       a.carrier_id,
       a.outcome,
       a.outcome_reason_code as reason_code,
       count(*)::bigint as attempts
  from public.tenant_applications a
  join tz on tz.tenant_id = a.tenant_id
 where a.status = 'closed' and a.outcome <> 'issued' and a.outcome_recorded_at is not null
 group by a.tenant_id, (a.outcome_recorded_at at time zone tz.tz)::date, a.carrier_id, a.outcome, a.outcome_reason_code
with data;

create unique index if not exists mv_la3_declines_key
  on public.mv_la3_declines (tenant_id, day, carrier_id, outcome, reason_code) nulls not distinct;

-- ── 3 · counteroffers ───────────────────────────────────────────────────────
create materialized view if not exists public.mv_la3_counteroffers as
with tz as (
  select t.id as tenant_id, coalesce(z.name, 'UTC') as tz
    from public.tenants t
    left join public.agency_profiles ap on ap.tenant_id = t.id
    left join pg_catalog.pg_timezone_names z on z.name = ap.timezone
)
select o.tenant_id,
       (o.received_at at time zone tz.tz)::date as day,
       a.carrier_id,
       o.status,
       count(*)::bigint as counteroffers,
       coalesce(sum(o.offered_face_cents), 0)::bigint as offered_face_cents
  from public.tenant_application_counteroffers o
  join public.tenant_applications a on a.id = o.application_id and a.tenant_id = o.tenant_id
  join tz on tz.tenant_id = o.tenant_id
 group by o.tenant_id, (o.received_at at time zone tz.tz)::date, a.carrier_id, o.status
with data;

create unique index if not exists mv_la3_counteroffers_key
  on public.mv_la3_counteroffers (tenant_id, day, carrier_id, status) nulls not distinct;

-- No RLS on a materialised view: nobody but the owner and service_role reads these directly.
revoke all on public.mv_la3_funnel from public, anon, authenticated, tenant_app;
revoke all on public.mv_la3_declines from public, anon, authenticated, tenant_app;
revoke all on public.mv_la3_counteroffers from public, anon, authenticated, tenant_app;

-- ── 4 · the reader ──────────────────────────────────────────────────────────
create or replace function public.la3_sales_report(p_tenant_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_report jsonb;
begin
  if p_tenant_id is null or p_from is null or p_to is null or p_from > p_to then
    raise exception 'SALES_REPORT_RANGE_INVALID';
  end if;

  select jsonb_build_object(
    'tenant_id', p_tenant_id,
    'from', p_from,
    'to', p_to,
    'totals', (
      select jsonb_build_object(
        'quoted_leads', coalesce(sum(f.quoted_leads), 0),
        'reached_ready', coalesce(sum(f.reached_ready), 0),
        'submitted', coalesce(sum(f.submitted), 0),
        'issued', coalesce(sum(f.issued), 0),
        'placed', null)
        from mv_la3_funnel f
       where f.tenant_id = p_tenant_id and f.day between p_from and p_to),
    'funnel', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', f.day, 'carrier_id', f.carrier_id, 'product_code', f.product_code,
               'case_source', f.case_source, 'campaign_id', f.campaign_id, 'producer_id', f.producer_id,
               'quoted_leads', f.quoted_leads, 'reached_ready', f.reached_ready,
               'submitted', f.submitted, 'issued', f.issued, 'placed', null)
             order by f.day, f.carrier_id, f.product_code, f.producer_id)
        from mv_la3_funnel f
       where f.tenant_id = p_tenant_id and f.day between p_from and p_to), '[]'::jsonb),
    'declines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', d.day, 'carrier_id', d.carrier_id, 'outcome', d.outcome,
               'reason_code', d.reason_code, 'attempts', d.attempts)
             order by d.day, d.carrier_id, d.outcome, d.reason_code)
        from mv_la3_declines d
       where d.tenant_id = p_tenant_id and d.day between p_from and p_to), '[]'::jsonb),
    'counteroffers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', o.day, 'carrier_id', o.carrier_id, 'status', o.status,
               'counteroffers', o.counteroffers, 'offered_face_cents', o.offered_face_cents)
             order by o.day, o.carrier_id, o.status)
        from mv_la3_counteroffers o
       where o.tenant_id = p_tenant_id and o.day between p_from and p_to), '[]'::jsonb),
    'placed', null,
    'partial', jsonb_build_array('placed')
  ) into v_report;

  return v_report;
end;
$function$;

revoke all on function public.la3_sales_report(uuid, date, date) from public, anon, authenticated, tenant_app;
grant execute on function public.la3_sales_report(uuid, date, date) to service_role;

create or replace function public.la3_refresh_sales_report()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  refresh materialized view concurrently public.mv_la3_funnel;
  refresh materialized view concurrently public.mv_la3_declines;
  refresh materialized view concurrently public.mv_la3_counteroffers;
end;
$function$;

revoke all on function public.la3_refresh_sales_report() from public, anon, authenticated, tenant_app;
grant execute on function public.la3_refresh_sales_report() to service_role;

-- ── 5 · checks ──────────────────────────────────────────────────────────────
do $$
declare
  v_report jsonb := public.la3_sales_report('00000000-0000-0000-0000-000000000000'::uuid, current_date - 30, current_date);
begin
  if not (v_report ? 'totals' and v_report ? 'funnel' and v_report ? 'declines' and v_report ? 'counteroffers')
     or v_report->'placed' <> 'null'::jsonb
     or v_report->'totals'->'placed' <> 'null'::jsonb then
    raise exception '20260926101200: la3_sales_report does not return the report shape with placed = null';
  end if;
  if (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
       where c.relname in ('mv_la3_funnel_key', 'mv_la3_declines_key', 'mv_la3_counteroffers_key')
         and i.indisunique and i.indpred is null and i.indexprs is null) <> 3 then
    raise exception '20260926101200: a sales report view cannot be refreshed concurrently';
  end if;
  if has_table_privilege('tenant_app', 'public.mv_la3_funnel', 'SELECT')
     or has_table_privilege('anon', 'public.mv_la3_declines', 'SELECT')
     or has_table_privilege('authenticated', 'public.mv_la3_counteroffers', 'SELECT') then
    raise exception '20260926101200: a sales report view is readable without the tenant filter';
  end if;
  if has_function_privilege('tenant_app', 'public.la3_sales_report(uuid, date, date)', 'execute') then
    raise exception '20260926101200: la3_sales_report is callable by tenant_app';
  end if;
  if (select count(*) from pg_matviews where schemaname = 'public'
        and matviewname in ('mv_la3_funnel', 'mv_la3_declines', 'mv_la3_counteroffers')) <> 3 then
    raise exception '20260926101200: a sales report materialised view is missing';
  end if;
end $$;
