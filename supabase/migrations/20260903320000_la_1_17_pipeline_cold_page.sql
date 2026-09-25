-- LA-1.17 performance hardening: keep the cold first page narrow.
-- The previous function materialized JSON display values for every matching lead
-- before applying LIMIT. Facets and counters still need all matching queue rows,
-- but only the bounded page needs lead JSON and display-name expansion.

create or replace function public.partner_lead_pipeline_page(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_closer_id uuid default null,
  p_product text default null,
  p_stage_id uuid default null,
  p_outcome text default null,
  p_timezone text default 'UTC',
  p_limit integer default 250,
  p_offset integer default 0
)
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
  with filtered_keys as materialized (
    select
      q.id as work_item_id,
      q.lead_id,
      q.product_line as product,
      q.status,
      q.claimed_by,
      q.owner_user_id,
      q.claimed_at,
      q.queued_at,
      q.disposition,
      q.disposition_at,
      q.pipeline_id,
      q.stage_id,
      q.updated_at,
      l.created_at as submitted_at,
      l.created_by as submitted_by_id
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
  ),
  enriched as materialized (
    select
      k.*,
      s.name as stage_name,
      s.stage_type,
      s.color as stage_color,
      s.position as stage_position,
      s.is_archived as stage_archived,
      p.name as pipeline_name,
      d.label as outcome,
      coalesce(u.name, 'Partner closer') as submitted_by_name
    from filtered_keys k
    join public.pipeline_stages s on s.id = k.stage_id and s.pipeline_id = k.pipeline_id
    join public.pipelines p on p.id = k.pipeline_id and p.tenant_id = p_tenant_id
    left join public.users u on u.id = k.submitted_by_id
    left join public.dispositions d on d.tenant_id = p_tenant_id and d.disposition_key = k.disposition
  ),
  page_base as materialized (
    select *
    from enriched
    order by queued_at desc, work_item_id desc
    limit least(greatest(coalesce(p_limit, 250), 1), 5000)
    offset greatest(coalesce(p_offset, 0), 0)
  ),
  page as materialized (
    select
      p.*,
      coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), nullif(btrim(l.values->>'name'), ''), 'Unnamed lead') as customer,
      deal.notes as outcome_note
    from page_base p
    join public.agent_leads l on l.id = p.lead_id and l.tenant_id = p_tenant_id and l.partner_id = p_partner_id
    left join lateral (
      select df.notes
      from public.deal_flow df
      where df.tenant_id = p_tenant_id
        and df.partner_id = p_partner_id
        and df.lead_id = p.lead_id
      order by df.updated_at desc
      limit 1
    ) deal on true
  ),
  totals as (
    select
      count(*)::integer as total,
      count(*) filter (where (submitted_at at time zone p_timezone)::date = (now() at time zone p_timezone)::date)::integer as submitted_today,
      count(*) filter (where status in ('claimed', 'buffer_active', 'handed_pending', 'la_active'))::integer as claimed,
      count(*) filter (where stage_type = 'won')::integer as converted,
      count(*) filter (where stage_type = 'open' and status not in ('completed', 'dropped'))::integer as still_open
    from enriched
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(
        r.lead_id, r.work_item_id, r.customer, r.submitted_at, r.updated_at,
        r.product, r.stage_id, r.disposition, r.outcome, r.outcome_note,
        r.submitted_by_id, r.submitted_by_name, r.status
      ) order by r.queued_at desc, r.work_item_id desc)
      from page r
    ), '[]'::jsonb),
    'stages', coalesce((
      select jsonb_agg(jsonb_build_array(
        stage.stage_id, stage.pipeline_id, stage.pipeline_name, stage.stage_name,
        stage.stage_position, stage.stage_type, stage.stage_color,
        stage.stage_archived, stage.lead_count
      ) order by stage.pipeline_name, stage.stage_position)
      from (
        select
          r.stage_id, r.pipeline_id, r.pipeline_name, r.stage_name,
          r.stage_position, r.stage_type, r.stage_color, r.stage_archived,
          count(*)::integer as lead_count
        from enriched r
        group by r.stage_id, r.pipeline_id, r.pipeline_name, r.stage_name,
          r.stage_position, r.stage_type, r.stage_color, r.stage_archived
      ) stage
    ), '[]'::jsonb),
    'closers', coalesce((
      select jsonb_agg(jsonb_build_array(closer.submitted_by_id, closer.submitted_by_name) order by closer.submitted_by_name)
      from (select distinct submitted_by_id, submitted_by_name from enriched where submitted_by_id is not null) closer
    ), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(product order by product) from (select distinct product from enriched) products), '[]'::jsonb),
    'outcomes', coalesce((
      select jsonb_agg(jsonb_build_array(outcome.disposition, coalesce(outcome.outcome, outcome.disposition)) order by coalesce(outcome.outcome, outcome.disposition))
      from (select distinct disposition, outcome from enriched where disposition is not null) outcome
    ), '[]'::jsonb),
    'total', totals.total,
    'next_offset', case
      when greatest(coalesce(p_offset, 0), 0) + (select count(*) from page) < totals.total
      then greatest(coalesce(p_offset, 0), 0) + (select count(*) from page)
      else null
    end,
    'counters', jsonb_build_object(
      'submittedToday', totals.submitted_today,
      'claimed', totals.claimed,
      'converted', totals.converted,
      'stillOpen', totals.still_open
    )
  )
  from totals;
$$;

revoke all on function public.partner_lead_pipeline_page(uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_lead_pipeline_page(uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer) to service_role;
