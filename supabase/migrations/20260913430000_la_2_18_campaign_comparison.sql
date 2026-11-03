-- ---------------------------------------------------------------------------
-- LA-2.18 · Campaign comparison
--
-- Comparison is deliberately a request-time calculation. The caller supplies two matched periods;
-- the function refuses unequal lengths or different starting weekdays so a small campaign cannot be
-- made to look better by comparing its Tuesday with somebody else's holiday weekend.
-- ---------------------------------------------------------------------------

create or replace function public.tenant_campaign_comparison(
  p_tenant_id uuid,
  p_campaign_a_id uuid,
  p_campaign_b_id uuid,
  p_from_a date,
  p_to_a date,
  p_from_b date,
  p_to_b date,
  p_metric text default 'contact_rate'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
begin
  if p_metric not in ('contact_rate', 'conversion_rate', 'cost_per_issued') then
    raise exception 'campaign_comparison_invalid_metric';
  end if;
  if p_from_a > p_to_a or p_from_b > p_to_b then
    raise exception 'campaign_comparison_invalid_date_range';
  end if;
  if (p_to_a - p_from_a) <> (p_to_b - p_from_b) then
    raise exception 'campaign_comparison_periods_must_match';
  end if;
  if extract(isodow from p_from_a) <> extract(isodow from p_from_b) then
    raise exception 'campaign_comparison_weekdays_must_align';
  end if;
  if not exists (
    select 1 from tenant_campaigns c
     where c.id = p_campaign_a_id and c.tenant_id = p_tenant_id
  ) or not exists (
    select 1 from tenant_campaigns c
     where c.id = p_campaign_b_id and c.tenant_id = p_tenant_id
  ) then
    raise exception 'campaign_comparison_campaign_not_found';
  end if;

  with selected_periods as (
    select 'a'::text as side, c.id as campaign_id, c.name as campaign_name, v.name as vendor_name,
           p_from_a as from_date, p_to_a as to_date, c.total_spend_cents, c.credits_received_cents,
           c.records_purchased
      from tenant_campaigns c
      join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = c.tenant_id
     where c.id = p_campaign_a_id and c.tenant_id = p_tenant_id
    union all
    select 'b'::text, c.id, c.name, v.name, p_from_b, p_to_b, c.total_spend_cents,
           c.credits_received_cents, c.records_purchased
      from tenant_campaigns c
      join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = c.tenant_id
     where c.id = p_campaign_b_id and c.tenant_id = p_tenant_id
  ),
  lead_rollup as (
    select sp.side, l.id,
      exists (
        select 1 from tenant_call_attempts a
         where a.tenant_id = l.tenant_id and a.lead_id = l.id
           and a.attempted_at >= sp.from_date::timestamptz
           and a.attempted_at < (sp.to_date + 1)::timestamptz
      ) as attempted,
      exists (
        select 1 from tenant_call_attempts a
         where a.tenant_id = l.tenant_id and a.lead_id = l.id
           and a.disposition is not null and is_contact_disposition(a.disposition)
           and a.attempted_at >= sp.from_date::timestamptz
           and a.attempted_at < (sp.to_date + 1)::timestamptz
      ) as contacted,
      exists (
        select 1 from tenant_application_cases a
         where a.tenant_id = l.tenant_id and a.lead_id = l.id
           and a.status <> 'abandoned'
           and a.opened_at >= sp.from_date::timestamptz
           and a.opened_at < (sp.to_date + 1)::timestamptz
           and a.campaign_id is not distinct from l.campaign_id
      ) as applied,
      exists (
        select 1 from tenant_issued_policies p
         where p.tenant_id = l.tenant_id and p.lead_id = l.id and p.status = 'issued'
           and p.issued_at >= sp.from_date::timestamptz
           and p.issued_at < (sp.to_date + 1)::timestamptz
           and p.campaign_id is not distinct from l.campaign_id
      ) as issued
      from selected_periods sp
      join agent_leads l on l.tenant_id = p_tenant_id and l.campaign_id = sp.campaign_id
       and l.created_at >= sp.from_date::timestamptz
       and l.created_at < (sp.to_date + 1)::timestamptz
  ),
  summary as (
    select sp.side, sp.campaign_id, sp.campaign_name, sp.vendor_name, sp.from_date, sp.to_date,
           sp.total_spend_cents, sp.credits_received_cents, sp.records_purchased,
           count(r.id)::integer as leads,
           count(r.id) filter (where r.attempted)::integer as attempted,
           count(r.id) filter (where r.contacted)::integer as contacted,
           count(r.id) filter (where r.applied)::integer as applications,
           count(r.id) filter (where r.issued)::integer as issued,
           greatest(sp.total_spend_cents - sp.credits_received_cents, 0)::numeric
             * count(r.id) / nullif(sp.records_purchased, 0) as allocated_spend_cents
      from selected_periods sp
      left join lead_rollup r on r.side = sp.side
     group by sp.side, sp.campaign_id, sp.campaign_name, sp.vendor_name, sp.from_date, sp.to_date,
              sp.total_spend_cents, sp.credits_received_cents, sp.records_purchased
  ),
  metric as (
    select
      case when p_metric = 'contact_rate' then 'Contact rate'
           when p_metric = 'conversion_rate' then 'Issued conversion'
           else 'Cost per issued policy' end as label,
      case when p_metric = 'contact_rate' then 'percent'
           when p_metric = 'conversion_rate' then 'percent'
           else 'cents' end as unit,
       case when p_metric = 'cost_per_issued' then a.issued else a.leads end as sample_a,
       case when p_metric = 'cost_per_issued' then b.issued else b.leads end as sample_b,
       a.leads as leads_a,
       b.leads as leads_b,
      case when p_metric = 'contact_rate' then a.contacted else a.issued end as numerator_a,
      case when p_metric = 'contact_rate' then b.contacted else b.issued end as numerator_b,
      case when p_metric = 'cost_per_issued' then
        round(a.allocated_spend_cents / nullif(a.issued, 0), 2)
        else round(100.0 * (case when p_metric = 'contact_rate' then a.contacted else a.issued end) / nullif(a.leads, 0), 2)
      end as value_a,
      case when p_metric = 'cost_per_issued' then
        round(b.allocated_spend_cents / nullif(b.issued, 0), 2)
        else round(100.0 * (case when p_metric = 'contact_rate' then b.contacted else b.issued end) / nullif(b.leads, 0), 2)
      end as value_b
      from summary a join summary b on a.side = 'a' and b.side = 'b'
  ),
  funnel as (
    select 1 as stage_order, 'leads_received'::text as stage, a.leads as a_count, b.leads as b_count from summary a join summary b on a.side = 'a' and b.side = 'b'
    union all select 2, 'attempted', a.attempted, b.attempted from summary a join summary b on a.side = 'a' and b.side = 'b'
    union all select 3, 'contacted', a.contacted, b.contacted from summary a join summary b on a.side = 'a' and b.side = 'b'
    union all select 4, 'applications', a.applications, b.applications from summary a join summary b on a.side = 'a' and b.side = 'b'
    union all select 5, 'issued_policies', a.issued, b.issued from summary a join summary b on a.side = 'a' and b.side = 'b'
  )
  select jsonb_build_object(
    'metric', jsonb_build_object(
      'key', p_metric, 'label', m.label, 'unit', m.unit,
      'a_value', m.value_a, 'b_value', m.value_b,
      'difference', case when m.value_a is null or m.value_b is null then null else round(m.value_b - m.value_a, 2) end
    ),
    'campaign_a', (select jsonb_build_object('id', campaign_id, 'name', campaign_name, 'vendor_name', vendor_name, 'from', from_date, 'to', to_date, 'leads', leads, 'attempted', attempted, 'contacted', contacted, 'applications', applications, 'issued_policies', issued, 'allocated_spend_cents', round(allocated_spend_cents, 2)) from summary where side = 'a'),
    'campaign_b', (select jsonb_build_object('id', campaign_id, 'name', campaign_name, 'vendor_name', vendor_name, 'from', from_date, 'to', to_date, 'leads', leads, 'attempted', attempted, 'contacted', contacted, 'applications', applications, 'issued_policies', issued, 'allocated_spend_cents', round(allocated_spend_cents, 2)) from summary where side = 'b'),
    'funnel', coalesce((select jsonb_agg(jsonb_build_object('stage', stage, 'a_count', a_count, 'b_count', b_count, 'difference', b_count - a_count, 'a_rate_percent', round(100.0 * a_count / nullif((select leads from summary where side = 'a'), 0), 2), 'b_rate_percent', round(100.0 * b_count / nullif((select leads from summary where side = 'b'), 0), 2)) order by stage_order) from funnel), '[]'::jsonb),
    'matched_periods', jsonb_build_object('same_length', true, 'aligned_start_weekday', true, 'days', (p_to_a - p_from_a) + 1),
    'confidence', jsonb_build_object(
      'level', case
        when least(m.sample_a, m.sample_b) < 200 then 'insufficient'
        when p_metric = 'cost_per_issued' then 'directional'
        when abs((m.numerator_a::numeric / nullif(m.sample_a, 0)) - (m.numerator_b::numeric / nullif(m.sample_b, 0))) /
          nullif(sqrt((m.numerator_a::numeric / nullif(m.sample_a, 0)) * (1 - m.numerator_a::numeric / nullif(m.sample_a, 0)) / nullif(m.sample_a, 0) + (m.numerator_b::numeric / nullif(m.sample_b, 0)) * (1 - m.numerator_b::numeric / nullif(m.sample_b, 0)) / nullif(m.sample_b, 0)), 0) >= 1.96 then 'strong'
        else 'not_conclusive' end,
       'sample_a', m.sample_a, 'sample_b', m.sample_b,
       'size_warning', case when m.leads_a <> m.leads_b then 'Campaign sizes differ; use the rates and costs as the comparison, not raw volume.' else null end,
      'needed_for_200', greatest(0, 200 - least(m.sample_a, m.sample_b)),
      'statement', case
        when least(m.sample_a, m.sample_b) < 200 then format('Too few comparable observations to tell these apart yet — needs about %s more in the smaller sample.', greatest(0, 200 - least(m.sample_a, m.sample_b)))
        when p_metric = 'cost_per_issued' then 'Both campaigns have at least 200 issued-policy observations; the cost difference is directional, not proof that one campaign caused the better result.'
         when abs((m.numerator_a::numeric / nullif(m.sample_a, 0)) - (m.numerator_b::numeric / nullif(m.sample_b, 0))) /
           nullif(sqrt((m.numerator_a::numeric / nullif(m.sample_a, 0)) * (1 - m.numerator_a::numeric / nullif(m.sample_a, 0)) / nullif(m.sample_a, 0) + (m.numerator_b::numeric / nullif(m.sample_b, 0)) * (1 - m.numerator_b::numeric / nullif(m.sample_b, 0)) / nullif(m.sample_b, 0)), 0) >= 1.96 then format('With %s and %s observations, this difference is unlikely to be chance.', m.sample_a, m.sample_b)
        else 'The observed difference is not yet distinguishable from normal variation at the 95% level.' end
    )
  ) into v_result
  from metric m;

  return v_result;
end;
$function$;

revoke all on function public.tenant_campaign_comparison(uuid, uuid, uuid, date, date, date, date, text) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_campaign_comparison(uuid, uuid, uuid, date, date, date, date, text) to service_role;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'tenant_campaign_comparison') then
    raise exception 'campaign comparison function did not land';
  end if;
end $$;
