-- The Data API caps table-returning RPC responses at the project row limit. Return one
-- JSON document so the server can receive the already-filtered 5,000-row read model in one call.

create or replace function public.partner_lead_pipeline_payload(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_closer_id uuid default null,
  p_product text default null,
  p_stage_id uuid default null,
  p_outcome text default null
)
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
  with rows as (
    select
      l.id,
      q.id as work_item_id,
      coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), nullif(btrim(l.values->>'name'), ''), 'Unnamed lead') as customer,
      l.values,
      l.created_at as submitted_at,
      q.updated_at,
      q.product_line as product,
      s.id as stage_id,
      s.name as stage_name,
      s.stage_type,
      s.color as stage_color,
      s.position as stage_position,
      s.is_archived as stage_archived,
      p.id as pipeline_id,
      p.name as pipeline_name,
      q.disposition,
      d.label as outcome,
      deal.notes as outcome_note,
      l.created_by as submitted_by_id,
      coalesce(u.name, 'Partner closer') as submitted_by_name,
      q.status
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id and l.partner_id = q.partner_id
    join public.pipeline_stages s on s.id = q.stage_id and s.pipeline_id = q.pipeline_id
    join public.pipelines p on p.id = q.pipeline_id and p.tenant_id = q.tenant_id
    left join public.users u on u.id = l.created_by
    left join public.dispositions d on d.tenant_id = q.tenant_id and d.disposition_key = q.disposition
    left join lateral (
      select df.notes
      from public.deal_flow df
      where df.tenant_id = q.tenant_id and df.partner_id = q.partner_id and df.lead_id = q.lead_id
      order by df.updated_at desc
      limit 1
    ) deal on true
    where q.tenant_id = p_tenant_id
      and q.partner_id = p_partner_id
      and (p_date_from is null or q.queued_at >= p_date_from::timestamptz)
      and (p_date_to is null or q.queued_at < (p_date_to + 1)::timestamptz)
      and (p_closer_id is null or l.created_by = p_closer_id)
      and (p_product is null or q.product_line = p_product)
      and (p_stage_id is null or q.stage_id = p_stage_id)
      and (p_outcome is null or q.disposition = p_outcome)
    order by q.queued_at desc
    limit 5000
  )
  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.submitted_at desc), '[]'::jsonb)
  from rows;
$$;

revoke all on function public.partner_lead_pipeline_payload(uuid, uuid, date, date, uuid, text, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_lead_pipeline_payload(uuid, uuid, date, date, uuid, text, uuid, text) to service_role;
