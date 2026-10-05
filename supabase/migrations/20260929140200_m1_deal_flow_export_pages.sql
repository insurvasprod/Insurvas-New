-- M1 perf · LA-1.13-10, the deal flow CSV at 10,000 rows.
--
-- Measured 2026-09-30: GET /api/app/deal-flow?format=csv answered 400 every time. The route asked
-- list_deal_flow_report for one 10,000-row page, and that call hit the 8 s statement timeout on 6 of
-- 6 runs. An EXPLAIN of the same body (read-only, load-test tenant, 9,012 rows in 30 days) ran 72 s:
-- a per-row history lateral into tenant_lead_activity (10 s), one jsonb_agg over 9,012 whole-row
-- payloads (35 s) and the KPIs, partner summary, filter options and window count the CSV never
-- prints. The grid's own 100-row page is fine (1.4 s) and is not changed here.
--
-- list_deal_flow_export is the CSV's own read. Its settings, term, base and filtered CTEs are the
-- LIVE list_deal_flow_report's (read 2026-09-30), so the export filters exactly as the grid does.
-- Around them:
--   keys       the next p_limit deals after a cursor (local_date, created_at, id), in the grid's
--              order (local_date desc, created_at desc, id desc), from deal_flow alone. Only the
--              deal's own columns filter here, so the window never skips a row the grid shows.
--   filtered   restricted to that window, then the grid's full filter (stage type, search) applies.
--   rows       the grid's row payload plus the names and issued date the CSV prints. No history,
--              KPIs, summary or options.
--   more/next  a full window means there may be more. The caller asks again from next.
-- Each call handles at most p_limit (default 1,000, cap 5,000) deals, so the export is a series of
-- bounded reads instead of one that grows with the report. lib/dealFlow/service.ts streams the CSV
-- page by page and, before this file, pages list_deal_flow_report instead.
--
-- deal_flow_tenant_order_idx serves the keys window as one backward index range.

create index if not exists deal_flow_tenant_order_idx
  on public.deal_flow (tenant_id, local_date, created_at, id);

create or replace function public.list_deal_flow_export(
  p_tenant_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_partner_id uuid default null,
  p_product_line text default null,
  p_agent_id uuid default null,
  p_status text default null,
  p_search text default null,
  p_stage_type text default null,
  p_after_local_date date default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 1000
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
set jit to 'off'
as $function$
with settings as (
  select
    least(5000, greatest(1, coalesce(p_limit, 1000))) as page_size,
    left(nullif(btrim(coalesce(p_search, '')), ''), 120) as search_term
),
term as (
  select
    s.page_size,
    s.search_term,
    case when s.search_term is null then null
         else '%' || replace(replace(replace(s.search_term, '\', '\\'), '%', '\%'), '_', '\_') || '%' end as search_like,
    regexp_replace(coalesce(s.search_term, ''), '[^0-9]', '', 'g') as search_digits
  from settings s
),
-- The export window: the next page_size deals after the cursor, in the grid's order, read from
-- deal_flow alone. Only the deal's own columns filter here, so the window never skips a row the
-- report would show. The joined filters (stage type, search) still apply in filtered below.
keys as (
  select d.id, d.local_date, d.created_at
  from public.deal_flow d
  where d.tenant_id = p_tenant_id
    and (p_from_date is null or d.local_date >= p_from_date)
    and (p_to_date is null or d.local_date <= p_to_date)
    and (p_partner_id is null or d.partner_id = p_partner_id)
    and (p_product_line is null or d.product_line = p_product_line)
    and (p_agent_id is null or d.worked_by = p_agent_id)
    and (p_status is null or d.status = p_status)
    and (d.local_date, d.created_at, d.id) < (
      coalesce(p_after_local_date, 'infinity'::date),
      coalesce(p_after_created_at, 'infinity'::timestamptz),
      coalesce(p_after_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
    )
  order by d.local_date desc, d.created_at desc, d.id desc
  limit least(5000, greatest(1, coalesce(p_limit, 1000)))
),
-- Inlined into each reference, so the filters below push down into it.
base as not materialized (
  select
    d.id, d.lead_id, d.partner_id, d.submission_id, d.product_line, d.insured_name, d.phone,
    d.initial_quote, d.tracking_id, d.local_date, d.status, d.call_result, d.notes,
    d.carrier, d.product_type, d.monthly_premium_cents, d.face_amount_cents, d.draft_date,
    d.worked_by, d.buffer_agent, d.manual_entry, d.created_at, d.updated_at,
    d.campaign_id, d.vendor_id, d.source, d.disposition_at, d.disposition_by,
    p.name as partner_name,
    c.name as campaign_name,
    case when d.source = 'inbound' and p.name is not null then p.name
         else coalesce(v.name, cv.name, p.name) end as vendor_name,
    dl.label as call_result_label,
    coalesce(ls.id, ds.id) as stage_id,
    coalesce(ls.name, ds.name) as stage_name,
    coalesce(ls.stage_type, ds.stage_type) as stage_type,
    (l.stage_id is not null and l.stage_id is distinct from d.stage_id) as stage_drift,
    left(coalesce(
      nullif(btrim(l.values->>'state'), ''),
      nullif(btrim(l.values->>'state_code'), ''),
      nullif(btrim(l.values->>'primary_state'), '')
    ), 40) as customer_state
  from public.deal_flow d
  left join public.agent_leads l on l.id = d.lead_id and l.tenant_id = d.tenant_id
  left join public.tenant_pipeline_stages ls on ls.id = l.stage_id
  left join public.tenant_pipeline_stages ds on ds.id = d.stage_id
  left join public.partners p on p.id = d.partner_id and p.tenant_id = d.tenant_id
  left join public.tenant_campaigns c on c.id = d.campaign_id and c.tenant_id = d.tenant_id
  left join public.tenant_lead_vendors v on v.id = d.vendor_id and v.tenant_id = d.tenant_id
  left join public.tenant_lead_vendors cv on cv.id = c.vendor_id and cv.tenant_id = d.tenant_id
  left join public.dispositions dl on dl.tenant_id = d.tenant_id and dl.disposition_key = d.call_result
  where d.tenant_id = p_tenant_id
),
filtered as (
  select b.*
  from base b
  cross join term s
  where b.id = any(array(select k.id from keys k))
    and (p_from_date is null or b.local_date >= p_from_date)
    and (p_to_date is null or b.local_date <= p_to_date)
    and (p_partner_id is null or b.partner_id = p_partner_id)
    and (p_product_line is null or b.product_line = p_product_line)
    and (p_agent_id is null or b.worked_by = p_agent_id)
    and (p_status is null or b.status = p_status)
    -- A row with no resolvable stage counts as in progress, here and in the KPIs.
    and (p_stage_type is null or coalesce(b.stage_type, 'open') = p_stage_type)
    and (
      s.search_like is null
      or b.insured_name ilike s.search_like
      or b.phone ilike s.search_like
      or b.partner_name ilike s.search_like
      or b.product_line ilike s.search_like
      or b.carrier ilike s.search_like
      or b.call_result ilike s.search_like
      or b.call_result_label ilike s.search_like
      or b.campaign_name ilike s.search_like
      or b.vendor_name ilike s.search_like
      or b.stage_name ilike s.search_like
      or b.customer_state ilike s.search_like
      -- The copyable short ID is the first characters of the lead id.
      or left(b.lead_id::text, length(s.search_term)) = lower(s.search_term)
      or (length(s.search_digits) >= 3 and regexp_replace(coalesce(b.phone, ''), '[^0-9]', '', 'g') like '%' || s.search_digits || '%')
    )
),
decorated as (
  select
    f.local_date, f.created_at, f.id,
    to_jsonb(f) || jsonb_build_object(
      'worked_by_name', wu.name,
      'buffer_agent_name', bu.name,
      'disposition_by_name', du.name,
      'issued_at', ip.issued_at
    ) as payload
  from filtered f
  left join public.users wu on wu.id = f.worked_by
  left join public.users bu on bu.id = f.buffer_agent
  left join public.users du on du.id = f.disposition_by
  left join lateral (
    select max(t.issued_at) as issued_at
    from public.tenant_issued_policies t
    where t.tenant_id = p_tenant_id and t.lead_id = f.lead_id and t.status = 'issued'
  ) ip on true
)
select jsonb_build_object(
  'version', 1,
  'page_size', (select page_size from settings),
  'rows', coalesce((select jsonb_agg(d.payload order by d.local_date desc, d.created_at desc, d.id desc) from decorated d), '[]'::jsonb),
  -- A full window means there may be more: the caller asks again from its last key.
  'more', (select count(*) from keys) >= (select page_size from settings),
  'next', (
    select jsonb_build_object('local_date', k.local_date, 'created_at', k.created_at, 'id', k.id)
    from keys k
    order by k.local_date, k.created_at, k.id
    limit 1
  )
);
$function$;

revoke all on function public.list_deal_flow_export(uuid, date, date, uuid, text, uuid, text, text, text, date, timestamptz, uuid, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.list_deal_flow_export(uuid, date, date, uuid, text, uuid, text, text, text, date, timestamptz, uuid, integer) to service_role;

do $$
declare
  v_sig regprocedure;
  v_body text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929140200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  v_sig := to_regprocedure('public.list_deal_flow_export(uuid,date,date,uuid,text,uuid,text,text,text,date,timestamp with time zone,uuid,integer)');
  if v_sig is null then
    raise exception '20260929140200: list_deal_flow_export was not created';
  end if;
  if to_regclass('public.deal_flow_tenant_order_idx') is null then
    raise exception '20260929140200: the deal flow order index was not created';
  end if;
  v_body := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  if position('tenant_lead_activity' in v_body) > 0 or position('row_number()' in v_body) > 0 then
    raise exception '20260929140200: the export still builds history or ranks the whole report';
  end if;
  if position('any(array(select k.id from keys k))' in v_body) = 0 then
    raise exception '20260929140200: the export is not bounded by its keys window';
  end if;
  if has_function_privilege('anon', v_sig, 'execute') or has_function_privilege('authenticated', v_sig, 'execute') or has_function_privilege('tenant_app', v_sig, 'execute') then
    raise exception '20260929140200: the export is callable outside the service role';
  end if;
end
$$;
