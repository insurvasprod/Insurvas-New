-- LA-1.17: keep the 5,000-lead read below its latency budget by sending stage and
-- pipeline metadata once instead of repeating it on every row. This is an
-- internal server payload; the HTTP API continues to return the existing shape.

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
  with selected as materialized (
    select
      l.id,
      q.id as work_item_id,
      coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), nullif(btrim(l.values->>'name'), ''), 'Unnamed lead') as customer,
      l.created_at as submitted_at,
      l.created_by as submitted_by_id,
      q.updated_at,
      q.product_line as product,
      q.stage_id,
      q.pipeline_id,
      q.disposition,
      q.status,
      q.tenant_id,
      q.partner_id,
      q.lead_id
    from public.lead_queue q
    join public.agent_leads l
      on l.id = q.lead_id
      and l.tenant_id = q.tenant_id
      and l.partner_id = q.partner_id
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
  ),
  rows as materialized (
    select
      x.*,
      s.name as stage_name,
      s.stage_type,
      s.color as stage_color,
      s.position as stage_position,
      s.is_archived as stage_archived,
      p.name as pipeline_name,
      d.label as outcome,
      deal.notes as outcome_note,
      coalesce(u.name, 'Partner closer') as submitted_by_name
    from selected x
    join public.pipeline_stages s on s.id = x.stage_id and s.pipeline_id = x.pipeline_id
    join public.pipelines p on p.id = x.pipeline_id and p.tenant_id = x.tenant_id
    left join public.users u on u.id = x.submitted_by_id
    left join public.dispositions d on d.tenant_id = x.tenant_id and d.disposition_key = x.disposition
    left join lateral (
      select df.notes
      from public.deal_flow df
      where df.tenant_id = x.tenant_id
        and df.partner_id = x.partner_id
        and df.lead_id = x.lead_id
      order by df.updated_at desc
      limit 1
    ) deal on true
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(
        r.id,
        r.work_item_id,
        r.customer,
        r.submitted_at,
        r.updated_at,
        r.product,
        r.stage_id,
        r.disposition,
        r.outcome,
        r.outcome_note,
        r.submitted_by_id,
        r.submitted_by_name,
        r.status
      ) order by r.submitted_at desc)
      from rows r
    ), '[]'::jsonb),
    'stages', coalesce((
      select jsonb_agg(jsonb_build_array(
        stage.stage_id,
        stage.pipeline_id,
        stage.pipeline_name,
        stage.stage_name,
        stage.stage_position,
        stage.stage_type,
        stage.stage_color,
        stage.stage_archived
      ) order by stage.pipeline_name, stage.stage_position)
      from (
        select distinct
          r.stage_id,
          r.pipeline_id,
          r.pipeline_name,
          r.stage_name,
          r.stage_position,
          r.stage_type,
          r.stage_color,
          r.stage_archived
        from rows r
      ) stage
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.partner_lead_pipeline_payload(uuid, uuid, date, date, uuid, text, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_lead_pipeline_payload(uuid, uuid, date, date, uuid, text, uuid, text) to service_role;
