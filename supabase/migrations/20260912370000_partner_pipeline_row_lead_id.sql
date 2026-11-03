-- Return the lead id where the pipeline says it returns a lead id.
--
-- partner_lead_pipeline_page builds each row as
--
--   jsonb_build_array(id, id, customer, submitted_at, ...)
--
-- from a CTE that is `select q.* from public.lead_queue q join public.agent_leads l on l.id = q.lead_id`.
-- So `id` is lead_queue.id, and BOTH of the first two positions carry the work-item id. The lead id
-- is not in the payload at all.
--
-- lib/partnerLeads/service.ts destructures those positions as [id, workItemId, ...] and the partner
-- pipeline screen calls openDetail(row.id), which fetches /api/partner/leads/<id>. That reaches
-- getPartnerLeadDetail(tenantId, partnerId, leadId), which does
--
--   data.leads.find((item) => item.id === leadId)
--
-- against a work-item id, finds nothing, and throws "Lead not found". Clicking any lead in the
-- partner pipeline -- board or table -- fails, for every partner, every time.
--
-- Found by LA-1.7's "disabling a product hides new intake but keeps existing lead history readable",
-- which asserts the submitted lead is present by id. That assertion was right and the payload was
-- wrong; the check had no detail string, so it had only ever reported which line failed and never
-- which value. Detail added to it in the same pass.
--
-- Only the first argument changes: position 0 becomes lead_id, position 1 stays the work-item id,
-- which is exactly what the TypeScript already expects. Everything else is the live definition
-- reproduced verbatim.

CREATE OR REPLACE FUNCTION public.partner_lead_pipeline_page(p_tenant_id uuid, p_partner_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_closer_id uuid DEFAULT NULL::uuid, p_product text DEFAULT NULL::text, p_stage_id uuid DEFAULT NULL::uuid, p_outcome text DEFAULT NULL::text, p_timezone text DEFAULT 'UTC'::text, p_limit integer DEFAULT 250, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with filtered as (
    select q.*, l.values, l.created_at as submitted_at, l.created_by as submitted_by_id,
      coalesce(u.name, 'Partner closer') as submitted_by_name,
      coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), nullif(btrim(l.values->>'name'), ''), 'Unnamed lead') as customer
    from public.lead_queue q join public.agent_leads l on l.id=q.lead_id and l.tenant_id=q.tenant_id
    left join public.users u on u.id=l.created_by
    where q.tenant_id=p_tenant_id and q.partner_id=p_partner_id
      and (p_date_from is null or q.queued_at >= p_date_from::timestamptz)
      and (p_date_to is null or q.queued_at < (p_date_to + 1)::timestamptz)
      and (p_closer_id is null or l.created_by=p_closer_id)
      and (p_product is null or q.product_line=p_product)
      and (p_stage_id is null or q.stage_id=p_stage_id)
      and (p_outcome is null or q.disposition=p_outcome)
  ), page as (
    select * from filtered order by queued_at desc, id desc
    limit least(greatest(coalesce(p_limit,250),1),5000) offset greatest(coalesce(p_offset,0),0)
  ), stage_rows as (
    select coalesce(stage_id::text, stage_key) as stage_id, coalesce(pipeline_id::text,'default') as pipeline_id,
      coalesce(stage_key,'New') as stage_name, count(*)::integer as lead_count
    from filtered group by coalesce(stage_id::text, stage_key), coalesce(pipeline_id::text,'default'), coalesce(stage_key,'New')
  ), totals as (select count(*)::integer as total from filtered)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_array(lead_id, id, customer, submitted_at, updated_at, product_line,
      coalesce(stage_id::text, stage_key), coalesce(stage_key,'New'), 'open', disposition, disposition, null,
      submitted_by_id, submitted_by_name, status) order by queued_at desc, id desc) from page), '[]'::jsonb),
    'stages', coalesce((select jsonb_agg(jsonb_build_array(stage_id,pipeline_id,'Default pipeline',stage_name,0,'open','#64748b',false,lead_count)) from stage_rows), '[]'::jsonb),
    'closers', coalesce((select jsonb_agg(jsonb_build_array(submitted_by_id, submitted_by_name)) from (select distinct submitted_by_id, submitted_by_name from filtered where submitted_by_id is not null) c), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(product_line) from (select distinct product_line from filtered) p), '[]'::jsonb),
    'outcomes', coalesce((select jsonb_agg(jsonb_build_array(disposition, disposition)) from (select distinct disposition from filtered where disposition is not null) o), '[]'::jsonb),
    'total', totals.total,
    'next_offset', case when greatest(coalesce(p_offset,0),0)+(select count(*) from page)<totals.total then greatest(coalesce(p_offset,0),0)+(select count(*) from page) else null end,
    'counters', jsonb_build_object(
      'submittedToday', (select count(*)::integer from filtered where submitted_at::date = current_date),
      'claimed', (select count(*)::integer from filtered where status in ('claimed','buffer_active','handed_pending','la_active')),
      'converted', 0,
      'stillOpen', (select count(*)::integer from filtered where status not in ('completed','dropped'))
    )
  ) from totals;
$function$

