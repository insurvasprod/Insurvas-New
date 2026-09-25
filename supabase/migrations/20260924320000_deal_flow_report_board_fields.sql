-- Daily deal flow, built to the p-app-deal-flow board: what the report has to return for it.
--
-- Starts from the latest definition of list_deal_flow_report (20260903170000, which added the
-- filter options) and keeps everything it returned. What changes:
--
--   p_search        search moves into the report. The page used to filter the rows it had loaded,
--                   so a search could only ever find a deal on the page already on screen.
--   p_stage_type    the Status filter now speaks the same vocabulary as the Status pill: the
--                   lead's pipeline stage type (open / won / lost). p_status (deal_flow.status) is
--                   kept, because partner quality and existing exports still read that column.
--   p_focus_lead_id the disposition wizard opens this page with ?focus_lead_id=. When p_page is
--                   null the report returns the page that holds that deal; when the deal is outside
--                   the filters, it comes back separately as focus.row so the page can pin it.
--   per-row fields  campaign_name, vendor_name, source, disposition_at / disposition_by(_name),
--                   call_result_label, customer_state, stage_name / stage_type / stage_drift,
--                   worked_by_name, issued_at and a short disposition history.
--   kpis            computed over the WHOLE filtered set, not the page on screen.
--
-- The stage is the lead's CURRENT stage (agent_leads.stage_id), falling back to deal_flow.stage_id.
-- The two drift apart: complete_existing_dial_disposition (the LA-2 dialer path, latest in
-- 20260924240200) moves agent_leads.stage_id and lead_queue.stage_id but not deal_flow.stage_id.
-- stage_drift reports that per row and kpis.stage_drift counts it; nothing here patches the dialer.
--
-- The state column reads agent_leads.values (state / state_code / primary_state). It is returned
-- as customer_state, not lead_state, because agent_leads.lead_state is already the dial state
-- (retry / nurture / exhausted) and the two would be read as each other.
--
-- Vendor: an inbound deal's vendor is its partner. Otherwise the vendor the deal was bought from
-- (deal_flow.vendor_id, carried at write time), then the campaign's vendor, then the partner.
--
-- The signature changes, so the old function is dropped and the new one re-granted to service_role
-- only, exactly as before. The app tolerates the old function until this is applied.

-- The timeline reads one lead's disposition history; nothing indexed tenant_lead_activity by lead.
create index if not exists tenant_lead_activity_lead_disposition_idx
  on public.tenant_lead_activity (tenant_id, lead_id, dispositioned_at desc)
  where dispositioned_at is not null;

drop function if exists public.list_deal_flow_report(uuid, date, date, uuid, text, uuid, text, integer, integer);

create or replace function public.list_deal_flow_report(
  p_tenant_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_partner_id uuid default null,
  p_product_line text default null,
  p_agent_id uuid default null,
  p_status text default null,
  p_page integer default 1,
  p_page_size integer default 100,
  p_search text default null,
  p_stage_type text default null,
  p_focus_lead_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
with settings as (
  select
    least(10000, greatest(1, coalesce(p_page_size, 100))) as page_size,
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
-- Inlined into each reference, so the filters below push down into it.
base as not materialized (
  select
    d.id, d.lead_id, d.partner_id, d.submission_id, d.product_line, d.insured_name, d.phone,
    d.initial_quote, d.tracking_id, d.local_date, d.status, d.call_result, d.notes,
    d.carrier, d.product_type, d.monthly_premium_cents, d.face_amount_cents, d.draft_date,
    d.worked_by, d.manual_entry, d.created_at, d.updated_at,
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
  where (p_from_date is null or b.local_date >= p_from_date)
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
ranked as (
  select f.*, row_number() over (order by f.local_date desc, f.created_at desc, f.id desc) as rn
  from filtered f
),
focus as (
  select (
    select r.rn from ranked r
    where p_focus_lead_id is not null and r.lead_id = p_focus_lead_id
    order by r.rn
    limit 1
  ) as focus_rn
),
paging as (
  select
    s.page_size,
    case when p_page is null
         then greatest(1, coalesce(ceil(fo.focus_rn::numeric / s.page_size)::integer, 1))
         else greatest(1, p_page) end as page
  from term s
  cross join focus fo
),
page_rows as (
  select r.*
  from ranked r
  cross join paging g
  where r.rn > (g.page - 1)::bigint * g.page_size
    and r.rn <= g.page::bigint * g.page_size
),
-- The focused deal when the filters hide it, so the page can pin it rather than lose it.
pinned as (
  select b.*, null::bigint as rn
  from base b
  where p_focus_lead_id is not null
    and b.lead_id = p_focus_lead_id
    and not exists (select 1 from ranked r where r.lead_id = p_focus_lead_id)
  order by b.local_date desc, b.created_at desc
  limit 1
),
decorated as (
  select
    x.rn,
    x.is_pinned,
    (to_jsonb(x) - 'rn' - 'is_pinned') || jsonb_build_object(
      'worked_by_name', wu.name,
      'disposition_by_name', du.name,
      'issued_at', ip.issued_at,
      'history', coalesce(h.items, '[]'::jsonb)
    ) as payload
  from (
    select pr.*, false as is_pinned from page_rows pr
    union all
    select pn.*, true as is_pinned from pinned pn
  ) x
  left join public.users wu on wu.id = x.worked_by
  left join public.users du on du.id = x.disposition_by
  left join lateral (
    -- Nothing writes tenant_issued_policies yet; when something does, "Policy issued" appears.
    select max(t.issued_at) as issued_at
    from public.tenant_issued_policies t
    where t.tenant_id = p_tenant_id and t.lead_id = x.lead_id and t.status = 'issued'
  ) ip on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'at', a.dispositioned_at,
             'disposition', a.disposition,
             'label', coalesce(ad.label, a.disposition),
             'by_name', au.name
           ) order by a.dispositioned_at desc) as items
    from (
      select a0.dispositioned_at, a0.disposition, a0.agent_user_id
      from public.tenant_lead_activity a0
      where a0.tenant_id = p_tenant_id and a0.lead_id = x.lead_id and a0.dispositioned_at is not null
      order by a0.dispositioned_at desc
      limit 10
    ) a
    left join public.dispositions ad on ad.tenant_id = p_tenant_id and ad.disposition_key = a.disposition
    left join public.users au on au.id = a.agent_user_id
  ) h on true
),
kpis as (
  select jsonb_build_object(
    'deals_worked', count(*)::integer,
    'won', (count(*) filter (where f.stage_type = 'won'))::integer,
    'won_annualised_cents', coalesce(sum(f.monthly_premium_cents::bigint * 12) filter (where f.stage_type = 'won'), 0),
    'won_unpriced', (count(*) filter (where f.stage_type = 'won' and f.monthly_premium_cents is null))::integer,
    'in_progress', (count(*) filter (where coalesce(f.stage_type, 'open') not in ('won', 'lost')))::integer,
    'oldest_in_progress_days', floor(extract(epoch from (now() - min(f.created_at) filter (where coalesce(f.stage_type, 'open') not in ('won', 'lost')))) / 86400)::integer,
    'lost', (count(*) filter (where f.stage_type = 'lost'))::integer,
    'stage_drift', (count(*) filter (where f.stage_drift))::integer
  ) as value
  from filtered f
),
partner_totals as (
  select f.partner_id, max(f.partner_name) as partner_name, f.status, coalesce(f.stage_type, 'open') as stage_type, count(*)::integer as total
  from filtered f
  group by f.partner_id, f.status, coalesce(f.stage_type, 'open')
),
partner_options as (
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name), '[]'::jsonb) as value
  from public.partners p
  where p.tenant_id = p_tenant_id
),
agent_options as (
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'role', tu.role) order by u.name), '[]'::jsonb) as value
  from public.tenant_users tu
  join public.users u on u.id = tu.user_id
  where tu.tenant_id = p_tenant_id
)
select jsonb_build_object(
  'version', 2,
  'total', (select count(*)::integer from filtered),
  'page', (select page from paging),
  'page_size', (select page_size from paging),
  'rows', coalesce((select jsonb_agg(d.payload order by d.rn) from decorated d where not d.is_pinned), '[]'::jsonb),
  'focus', case when p_focus_lead_id is null then null else jsonb_build_object(
    'lead_id', p_focus_lead_id,
    'position', (select focus_rn from focus),
    'in_filter', (select focus_rn from focus) is not null,
    'row', (select d.payload from decorated d where d.is_pinned limit 1)
  ) end,
  'kpis', (select value from kpis),
  'summary', coalesce((select jsonb_agg(jsonb_build_object(
      'partner_id', t.partner_id, 'partner_name', t.partner_name, 'status', t.status,
      'stage_type', t.stage_type, 'total', t.total
    ) order by t.total desc) from partner_totals t), '[]'::jsonb),
  'options', jsonb_build_object(
    'partners', (select value from partner_options),
    'agents', (select value from agent_options)
  )
);
$$;

revoke all on function public.list_deal_flow_report(uuid, date, date, uuid, text, uuid, text, integer, integer, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.list_deal_flow_report(uuid, date, date, uuid, text, uuid, text, integer, integer, text, text, uuid) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_lead uuid;
  v_total integer;
  v_report jsonb;
  v_focus jsonb;
begin
  if to_regprocedure('public.list_deal_flow_report(uuid,date,date,uuid,text,uuid,text,integer,integer,text,text,uuid)') is null then
    raise exception 'list_deal_flow_report with p_search did not land';
  end if;
  if to_regprocedure('public.list_deal_flow_report(uuid,date,date,uuid,text,uuid,text,integer,integer)') is not null then
    raise exception 'the old list_deal_flow_report signature is still present';
  end if;
  if has_function_privilege('anon', 'public.list_deal_flow_report(uuid,date,date,uuid,text,uuid,text,integer,integer,text,text,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.list_deal_flow_report(uuid,date,date,uuid,text,uuid,text,integer,integer,text,text,uuid)', 'execute') then
    raise exception 'list_deal_flow_report is executable by a client role';
  end if;
  if to_regclass('public.tenant_lead_activity_lead_disposition_idx') is null then
    raise exception 'the lead-history index did not land';
  end if;

  select tenant_id into v_tenant from public.deal_flow group by tenant_id order by count(*) desc limit 1;
  if v_tenant is null then
    raise notice 'deal flow report: no tenant has deals; behaviour checks skipped';
    return;
  end if;

  v_report := public.list_deal_flow_report(v_tenant, null, null, null, null, null, null, 1, 25);
  v_total := (v_report->>'total')::integer;
  if v_report->'kpis' is null or (v_report->'kpis'->>'deals_worked')::integer <> v_total then
    raise exception 'kpis.deals_worked (%) is not the filtered total (%)', v_report->'kpis'->>'deals_worked', v_total;
  end if;
  if (v_report->'kpis'->>'won')::integer + (v_report->'kpis'->>'in_progress')::integer + (v_report->'kpis'->>'lost')::integer <> v_total then
    raise exception 'won + in progress + lost does not add up to the total';
  end if;
  if jsonb_array_length(v_report->'rows') <> least(v_total, 25) then
    raise exception 'the page holds % rows, expected %', jsonb_array_length(v_report->'rows'), least(v_total, 25);
  end if;
  if not (v_report->'rows'->0 ? 'stage_name' and v_report->'rows'->0 ? 'vendor_name' and v_report->'rows'->0 ? 'history') then
    raise exception 'the new per-row fields are missing';
  end if;

  if (public.list_deal_flow_report(v_tenant, null, null, null, null, null, null, 1, 25, 'no deal is called this 7f3a9c')->>'total')::integer <> 0 then
    raise exception 'a search for nothing found something';
  end if;

  -- Focus paging: with one deal per page, the oldest deal lives on the last page.
  select d.lead_id into v_lead from public.deal_flow d where d.tenant_id = v_tenant
   order by d.local_date asc, d.created_at asc, d.id asc limit 1;
  v_focus := public.list_deal_flow_report(v_tenant, null, null, null, null, null, null, null, 1, null, null, v_lead);
  if (v_focus->>'page')::integer <> v_total then
    raise exception 'focus paging returned page %, expected %', v_focus->>'page', v_total;
  end if;
  if (v_focus->'rows'->0->>'lead_id')::uuid is distinct from v_lead then
    raise exception 'the focused page does not hold the focused deal';
  end if;

  raise notice 'deal flow report: % deal(s); kpis add up; search, focus paging and the new fields are in place; % row(s) drift from their lead''s stage',
    v_total, v_report->'kpis'->>'stage_drift';
end $$;
