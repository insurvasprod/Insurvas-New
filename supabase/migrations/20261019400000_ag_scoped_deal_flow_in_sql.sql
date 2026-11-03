-- Agency Module 0 · AG-0.5 performance follow-up (2026-10-19) · deal flow pages a scope in SQL.
--
-- AG-0.5 made a narrowed agency session (manager, assistant, setter with producers) see only the deals credited
-- to its scope, but list_deal_flow_report and list_deal_flow_export take ONE agent (p_agent_id). For a scope of
-- several agents lib/dealFlow/service.ts walked the export once per agent, merged every row in code and counted
-- the page, total, KPIs and summary there: at 150 producers, 150 export walks and every deal they ever worked.
--
-- Both functions gain p_agent_ids uuid[] (last, default null), ANDed with every other filter:
--   · null (the default) = every agent — the body is the live one with one extra `p_agent_ids is null or …`
--     arm, and the app never sends the argument for a null scope, so solo tenants and the all-seeing roles run
--     exactly today's call;
--   · an array = only deals whose worked_by is in it (worked_by is the report's own "agent", decision D1).
-- The report's pinned focus row obeys it too: a focused deal outside the scope is "not in this view".
-- Scope always comes from scopeFor(session) in the app, never from a request parameter.
--
-- The old signatures are DROPPED, not overloaded: two candidates that both accept the old named arguments make
-- PostgREST refuse the call (PGRST203). The app's current calls name only old arguments, so they keep working
-- against the new functions while the code that sends p_agent_ids is deployed.
--
-- Bodies: the live pg_get_functiondef of each (read 2026-10-19), changed only at the lines marked [AG scoped].
-- Grants as live: execute to service_role only.
--
-- Rollback: re-run the two functions from 20260929140200 / the latest file that defines them, after
--   drop function public.list_deal_flow_report(uuid,date,date,uuid,text,uuid,text,integer,integer,text,text,uuid,uuid[]);
--   drop function public.list_deal_flow_export(uuid,date,date,uuid,text,uuid,text,text,text,date,timestamptz,uuid,integer,uuid[]);

begin;

drop function if exists public.list_deal_flow_report(uuid, date, date, uuid, text, uuid, text, integer, integer, text, text, uuid);
drop function if exists public.list_deal_flow_export(uuid, date, date, uuid, text, uuid, text, text, text, date, timestamptz, uuid, integer);

CREATE OR REPLACE FUNCTION public.list_deal_flow_report(p_tenant_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_partner_id uuid DEFAULT NULL::uuid, p_product_line text DEFAULT NULL::text, p_agent_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 100, p_search text DEFAULT NULL::text, p_stage_type text DEFAULT NULL::text, p_focus_lead_id uuid DEFAULT NULL::uuid, p_agent_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  where (p_from_date is null or b.local_date >= p_from_date)
    and (p_to_date is null or b.local_date <= p_to_date)
    and (p_partner_id is null or b.partner_id = p_partner_id)
    and (p_product_line is null or b.product_line = p_product_line)
    and (p_agent_id is null or b.worked_by = p_agent_id)
    -- [AG scoped] a narrowed session's agents (scopeFor); null = every agent, as before.
    and (p_agent_ids is null or b.worked_by = any(p_agent_ids))
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
    -- [AG scoped] a focused deal outside the scope is not pinned: it is "not in this view".
    and (p_agent_ids is null or b.worked_by = any(p_agent_ids))
  order by b.local_date desc, b.created_at desc
  limit 1
),
decorated as (
  select
    x.rn,
    x.is_pinned,
    (to_jsonb(x) - 'rn' - 'is_pinned') || jsonb_build_object(
      'worked_by_name', wu.name,
      'buffer_agent_name', bu.name,
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
  left join public.users bu on bu.id = x.buffer_agent
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
$function$;

CREATE OR REPLACE FUNCTION public.list_deal_flow_export(p_tenant_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_partner_id uuid DEFAULT NULL::uuid, p_product_line text DEFAULT NULL::text, p_agent_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_stage_type text DEFAULT NULL::text, p_after_local_date date DEFAULT NULL::date, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 1000, p_agent_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
 SET jit TO 'off'
AS $function$
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
    -- [AG scoped] a narrowed session's agents; null = every agent, as before.
    and (p_agent_ids is null or d.worked_by = any(p_agent_ids))
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
    and (p_agent_ids is null or b.worked_by = any(p_agent_ids))
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

revoke all on function public.list_deal_flow_report(uuid, date, date, uuid, text, uuid, text, integer, integer, text, text, uuid, uuid[]) from public, anon, authenticated, tenant_app;
grant execute on function public.list_deal_flow_report(uuid, date, date, uuid, text, uuid, text, integer, integer, text, text, uuid, uuid[]) to service_role;
revoke all on function public.list_deal_flow_export(uuid, date, date, uuid, text, uuid, text, text, text, date, timestamptz, uuid, integer, uuid[]) from public, anon, authenticated, tenant_app;
grant execute on function public.list_deal_flow_export(uuid, date, date, uuid, text, uuid, text, text, text, date, timestamptz, uuid, integer, uuid[]) to service_role;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_name text;
begin
  foreach v_name in array array['list_deal_flow_report', 'list_deal_flow_export'] loop
    if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = v_name) <> 1 then
      raise exception 'AG scoped: % must have exactly one signature (PostgREST cannot choose between overloads)', v_name;
    end if;
    if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = v_name
                    and 'p_agent_ids' = any (proargnames) and prosecdef) then
      raise exception 'AG scoped: % lacks p_agent_ids or is no longer security definer', v_name;
    end if;
    if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = v_name
          and prosrc like '%p_agent_ids is null or %.worked_by = any(p_agent_ids)%') <> 1 then
      raise exception 'AG scoped: % does not filter worked_by by p_agent_ids', v_name;
    end if;
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
