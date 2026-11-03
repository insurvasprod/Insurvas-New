-- ---------------------------------------------------------------------------
-- Scorecard (LA-2 §14 concept) · "which vendor should I buy from again"
--
-- Restates tenant_vendor_scorecard_report from its only definition (20260913420000) with the
-- concept board's missing pieces and the user's decisions:
--
--   Spend in the period   Net spend is split by the share of records received in the period —
--                         greatest(total - credits, 0) * leads received / records purchased —
--                         the exact formula tenant_campaign_comparison (20260913430000) uses, so
--                         True CPA and the comparison give one answer for one campaign and
--                         period. The old report divided a campaign's LIFETIME spend by the
--                         policies of the period, which made every short range look expensive.
--                         The lifetime figure is still returned as lifetime_net_spend_cents.
--   Persistency           p_persist_days (the page's toggle sends 60): only a policy issued at
--                         least N days ago that was still in force on day N counts — issued, or
--                         lapsed with lapsed_at on or after issued_at + N. Policies issued inside
--                         the last N days cannot be judged yet and are counted separately
--                         (totals.policies_not_yet_measurable) rather than silently dropped.
--   Test batches          tenant_campaigns.is_test_batch (20260925708000). A test batch keeps its
--                         row, is flagged, and is left out of the ranking.
--   Small samples         small_sample when a row has 1 to 4 issued policies: one more sale
--                         moves the figure a long way. Automatic; it is a chip, not an exclusion.
--   Ranking               cost_rank 1..n over rows that have a cost per issued policy and are
--                         not a test batch. Rows are returned ranked first (cheapest policy
--                         first), then rows without a policy, then test batches.
--   Vendor roll-up        vendor_rows: THE per-vendor cost per issued policy. /app/vendors reads
--                         it through lib/vendorScorecard, so there is one definition. A vendor's
--                         figures are over its committed campaigns; a vendor whose every campaign
--                         in scope is a test batch is rolled up over those and flagged.
--   Price per record      cost_per_record_cents and records_purchased on every row.
--   Speed to lead and     Per vendor, read from tenant_vendor_speed_to_lead and
--   consent               tenant_vendor_consent_coverage — the same objects /app/campaigns reads,
--                         so the two pages cannot disagree. Both are all-time and all campaigns:
--                         the views have no period, and a second definition with one would be
--                         the disagreement this avoids.
--   Attempts curve        attempts_to_contact gains share_of_contacts_percent: each attempt
--                         number's share of all contacts, beside its contact rate.
--   Default period        90 days when the caller sends no dates (was 11 months).
--
-- The signature gains p_persist_days, so the old function is dropped and the new one re-granted
-- exactly (service_role only, as before). Callers that send the six old arguments still resolve.
-- ---------------------------------------------------------------------------

drop function if exists public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text);

create or replace function public.tenant_vendor_scorecard_report(
  p_tenant_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_vendor_id uuid default null,
  p_campaign_id uuid default null,
  p_product_code text default null,
  p_persist_days integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_from date := coalesce(p_from_date, current_date - 89);
  v_to date := coalesce(p_to_date, current_date);
  v_persist integer := p_persist_days;
  -- Below this many issued policies a row is a small sample. Returned with the report so the page
  -- says the real threshold instead of a number typed into the UI.
  v_small_sample constant integer := 5;
  v_result jsonb;
begin
  if v_from > v_to then raise exception 'vendor_scorecard_invalid_date_range'; end if;
  if v_persist is not null and (v_persist < 1 or v_persist > 730) then
    raise exception 'vendor_scorecard_invalid_persist_days';
  end if;

  with scoped_campaigns as (
    select c.id as campaign_id, c.vendor_id, c.name as campaign_name, c.product_code,
           c.total_spend_cents, c.records_purchased, c.credits_received_cents,
           c.cost_per_record_cents, coalesce(c.is_test_batch, false) as is_test_batch,
           v.name as vendor_name
      from tenant_campaigns c
      join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = c.tenant_id
     where c.tenant_id = p_tenant_id
       and (p_vendor_id is null or c.vendor_id = p_vendor_id)
       and (p_campaign_id is null or c.id = p_campaign_id)
       and (p_product_code is null or c.product_code = p_product_code
            or exists (select 1 from agent_leads lp where lp.tenant_id = p_tenant_id and lp.campaign_id = c.id and lp.product_line = p_product_code))
  ),
  scoped_leads as (
    select l.id, l.tenant_id, l.campaign_id, l.product_line, l.created_at,
           c.vendor_id, c.campaign_name, c.vendor_name
      from agent_leads l
      join scoped_campaigns c on c.campaign_id = l.campaign_id
     where l.tenant_id = p_tenant_id
       and l.created_at >= v_from::timestamptz
       and l.created_at < (v_to + 1)::timestamptz
       and (p_product_code is null or l.product_line = p_product_code)
  ),
  lead_metrics as (
    select l.*,
      (select count(*)::integer from tenant_call_attempts a
        where a.tenant_id = l.tenant_id and a.lead_id = l.id
          and a.attempted_at >= v_from::timestamptz and a.attempted_at < (v_to + 1)::timestamptz) as attempts,
      (select case when exists (select 1 from tenant_call_attempts a
        where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.disposition is not null
          and is_contact_disposition(a.disposition)
          and a.attempted_at >= v_from::timestamptz and a.attempted_at < (v_to + 1)::timestamptz) then 1 else 0 end) as contacted,
      (select count(*)::integer from tenant_application_cases a
        where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.status <> 'abandoned'
          and a.opened_at >= v_from::timestamptz and a.opened_at < (v_to + 1)::timestamptz
          and a.campaign_id is not distinct from l.campaign_id) as applications,
      (select count(*)::integer from tenant_issued_policies p
        where p.tenant_id = l.tenant_id and p.lead_id = l.id
          and p.issued_at >= v_from::timestamptz and p.issued_at < (v_to + 1)::timestamptz
          and p.campaign_id is not distinct from l.campaign_id
          and case
                when v_persist is null then p.status = 'issued'
                else p.issued_at <= now() - make_interval(days => v_persist)
                     and (p.status = 'issued'
                          or (p.status in ('lapsed', 'cancelled') and p.lapsed_at is not null
                              and p.lapsed_at >= p.issued_at + make_interval(days => v_persist)))
              end) as issued_policies,
      (select count(*)::integer from tenant_issued_policies p
        where p.tenant_id = l.tenant_id and p.lead_id = l.id
          and p.issued_at >= v_from::timestamptz and p.issued_at < (v_to + 1)::timestamptz
          and p.campaign_id is not distinct from l.campaign_id
          and p.status in ('lapsed', 'cancelled')) as lapsed_policies,
      (select count(*)::integer from tenant_issued_policies p
        where v_persist is not null
          and p.tenant_id = l.tenant_id and p.lead_id = l.id
          and p.issued_at >= v_from::timestamptz and p.issued_at < (v_to + 1)::timestamptz
          and p.campaign_id is not distinct from l.campaign_id
          and p.issued_at > now() - make_interval(days => v_persist)) as policies_not_yet_measurable,
      (select count(*)::integer from tenant_application_cases a
        where a.tenant_id = l.tenant_id and a.lead_id = l.id
          and a.campaign_id is distinct from l.campaign_id) as attribution_warnings,
      (select count(*)::integer from deal_flow d
        where d.tenant_id = l.tenant_id and d.lead_id = l.id
          and d.campaign_id is distinct from l.campaign_id) as deal_attribution_warnings
    from scoped_leads l
  ),
  grouped as (
    select c.campaign_id, c.vendor_id, c.vendor_name, c.campaign_name,
      c.product_code, c.total_spend_cents, c.records_purchased, c.credits_received_cents,
      c.cost_per_record_cents, c.is_test_batch,
      (c.total_spend_cents - c.credits_received_cents) as lifetime_net_spend_cents,
      -- tenant_campaign_comparison's allocation, verbatim: spend follows the records received.
      round(greatest(c.total_spend_cents - c.credits_received_cents, 0)::numeric
        * count(l.id) / nullif(c.records_purchased, 0), 2) as net_spend_cents,
      count(l.id)::integer as leads_received,
      coalesce(sum(l.attempts), 0)::integer as attempts,
      coalesce(sum(l.contacted), 0)::integer as contacted_leads,
      coalesce(sum(l.applications), 0)::integer as applications,
      coalesce(sum(l.issued_policies), 0)::integer as issued_policies,
      coalesce(sum(l.lapsed_policies), 0)::integer as lapsed_policies,
      coalesce(sum(l.policies_not_yet_measurable), 0)::integer as policies_not_yet_measurable,
      coalesce(sum(l.attribution_warnings + l.deal_attribution_warnings), 0)::integer as attribution_warnings
    from scoped_campaigns c
    left join lead_metrics l on l.campaign_id = c.campaign_id
    group by c.campaign_id, c.vendor_id, c.vendor_name, c.campaign_name, c.product_code,
             c.total_spend_cents, c.records_purchased, c.credits_received_cents,
             c.cost_per_record_cents, c.is_test_batch
  ),
  costed as (
    select g.*,
      round(g.net_spend_cents / nullif(g.leads_received, 0), 2) as effective_cost_per_lead_cents,
      round(g.net_spend_cents / nullif(g.applications, 0), 2) as effective_cost_per_application_cents,
      round(g.net_spend_cents / nullif(g.issued_policies, 0), 2) as effective_cost_per_issued_policy_cents,
      round(100.0 * g.contacted_leads / nullif(g.leads_received, 0), 2) as contact_rate_percent,
      (g.issued_policies between 1 and v_small_sample - 1) as small_sample
    from grouped g
  ),
  report_rows as (
    select k.*,
      case when not k.is_test_batch and k.effective_cost_per_issued_policy_cents is not null
           then rank() over (
             partition by (not k.is_test_batch and k.effective_cost_per_issued_policy_cents is not null)
             order by k.effective_cost_per_issued_policy_cents)
      end::integer as cost_rank
    from costed k
  ),
  totals as (
    select coalesce(round(sum(net_spend_cents), 2), 0) as net_spend_cents,
      coalesce(sum(lifetime_net_spend_cents), 0)::bigint as lifetime_net_spend_cents,
      coalesce(sum(total_spend_cents), 0)::bigint as total_spend_cents,
      coalesce(sum(credits_received_cents), 0)::bigint as credits_received_cents,
      coalesce(sum(records_purchased), 0)::bigint as records_purchased,
      coalesce(sum(leads_received), 0)::integer as leads_received,
      coalesce(sum(attempts), 0)::integer as attempts,
      coalesce(sum(contacted_leads), 0)::integer as contacted_leads,
      coalesce(sum(applications), 0)::integer as applications,
      coalesce(sum(issued_policies), 0)::integer as issued_policies,
      coalesce(sum(lapsed_policies), 0)::integer as lapsed_policies,
      coalesce(sum(policies_not_yet_measurable), 0)::integer as policies_not_yet_measurable,
      coalesce(sum(attribution_warnings), 0)::integer as attribution_warnings,
      count(*)::integer as campaigns,
      count(*) filter (where is_test_batch)::integer as test_batch_campaigns,
      -- Spend that cannot be split because the campaign records no purchased count. It is not in
      -- net_spend_cents, and the page says so rather than showing a smaller number as the whole.
      count(*) filter (where net_spend_cents is null and lifetime_net_spend_cents > 0)::integer as unallocated_spend_campaigns
    from report_rows
  ),
  -- A vendor is judged on its committed buys. Only when every campaign of the vendor in scope is a
  -- test batch is it rolled up over those, and then it is flagged and left out of the ranking.
  vendor_basis as (
    select r.*, bool_and(r.is_test_batch) over (partition by r.vendor_id) as vendor_all_test
      from report_rows r
  ),
  vendor_grouped as (
    select b.vendor_id, max(b.vendor_name) as vendor_name,
      bool_and(b.is_test_batch) as is_test_batch,
      count(*)::integer as campaigns,
      coalesce(sum(b.total_spend_cents), 0)::bigint as total_spend_cents,
      coalesce(sum(b.records_purchased), 0)::bigint as records_purchased,
      coalesce(sum(b.credits_received_cents), 0)::bigint as credits_received_cents,
      coalesce(sum(b.lifetime_net_spend_cents), 0)::bigint as lifetime_net_spend_cents,
      round(sum(b.net_spend_cents), 2) as net_spend_cents,
      coalesce(sum(b.leads_received), 0)::integer as leads_received,
      coalesce(sum(b.attempts), 0)::integer as attempts,
      coalesce(sum(b.contacted_leads), 0)::integer as contacted_leads,
      coalesce(sum(b.applications), 0)::integer as applications,
      coalesce(sum(b.issued_policies), 0)::integer as issued_policies,
      coalesce(sum(b.lapsed_policies), 0)::integer as lapsed_policies,
      coalesce(sum(b.policies_not_yet_measurable), 0)::integer as policies_not_yet_measurable,
      coalesce(sum(b.attribution_warnings), 0)::integer as attribution_warnings
      from vendor_basis b
     where b.is_test_batch = b.vendor_all_test
     group by b.vendor_id
  ),
  vendor_costed as (
    select g.*,
      (select count(*)::integer from report_rows r where r.vendor_id = g.vendor_id and r.is_test_batch) as test_batch_campaigns,
      round(g.total_spend_cents::numeric / nullif(g.records_purchased, 0), 2) as cost_per_record_cents,
      round(g.net_spend_cents / nullif(g.leads_received, 0), 2) as effective_cost_per_lead_cents,
      round(g.net_spend_cents / nullif(g.applications, 0), 2) as effective_cost_per_application_cents,
      round(g.net_spend_cents / nullif(g.issued_policies, 0), 2) as effective_cost_per_issued_policy_cents,
      round(100.0 * g.contacted_leads / nullif(g.leads_received, 0), 2) as contact_rate_percent,
      (g.issued_policies between 1 and v_small_sample - 1) as small_sample,
      s.posted_leads as speed_posted_leads,
      s.dialled_leads as speed_dialled_leads,
      s.median_seconds as speed_median_seconds,
      s.dialled_within_60s_pct as speed_within_60s_pct,
      cc.leads as consent_leads,
      cc.claimed_certificates as consent_claimed_leads,
      cc.claimed_coverage_pct as consent_claimed_pct,
      cc.any_coverage_pct as consent_any_pct
      from vendor_grouped g
      left join tenant_vendor_speed_to_lead s on s.tenant_id = p_tenant_id and s.vendor_id = g.vendor_id
      left join tenant_vendor_consent_coverage cc on cc.tenant_id = p_tenant_id and cc.vendor_id = g.vendor_id
  ),
  vendor_rows as (
    select k.*,
      case when not k.is_test_batch and k.effective_cost_per_issued_policy_cents is not null
           then rank() over (
             partition by (not k.is_test_batch and k.effective_cost_per_issued_policy_cents is not null)
             order by k.effective_cost_per_issued_policy_cents)
      end::integer as cost_rank
    from vendor_costed k
  ),
  contact_by_slot as (
    select a.slot, count(*)::integer as attempts,
      count(*) filter (where is_contact_disposition(a.disposition))::integer as contacts
      from tenant_call_attempts a
      join scoped_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
     where a.disposition is not null
       and a.attempted_at >= v_from::timestamptz and a.attempted_at < (v_to + 1)::timestamptz
     group by a.slot
  ),
  attempts_to_contact as (
    select a.attempt_number, count(*)::integer as attempts,
      count(*) filter (where is_contact_disposition(a.disposition))::integer as contacts
      from tenant_call_attempts a
      join scoped_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
     where a.disposition is not null
       and a.attempted_at >= v_from::timestamptz and a.attempted_at < (v_to + 1)::timestamptz
     group by a.attempt_number
  ),
  attempts_shared as (
    select t.*, round(100.0 * t.contacts / nullif(sum(t.contacts) over (), 0), 2) as share_of_contacts_percent
      from attempts_to_contact t
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'generated_at', now(),
    'live', true, 'snapshot', false,
    'persist_days', v_persist,
    'small_sample_below', v_small_sample,
    'spend_basis', 'records_received_share',
    'totals', (select jsonb_build_object(
      'campaigns', campaigns, 'test_batch_campaigns', test_batch_campaigns,
      'unallocated_spend_campaigns', unallocated_spend_campaigns,
      'net_spend_cents', net_spend_cents, 'lifetime_net_spend_cents', lifetime_net_spend_cents,
      'total_spend_cents', total_spend_cents, 'credits_received_cents', credits_received_cents,
      'records_purchased', records_purchased, 'leads_received', leads_received,
      'attempts', attempts, 'contacted_leads', contacted_leads, 'applications', applications,
      'issued_policies', issued_policies, 'lapsed_policies', lapsed_policies,
      'policies_not_yet_measurable', policies_not_yet_measurable,
      'attribution_warnings', attribution_warnings,
      'effective_cost_per_lead_cents', round(net_spend_cents / nullif(leads_received, 0), 2),
      'effective_cost_per_application_cents', round(net_spend_cents / nullif(applications, 0), 2),
      'effective_cost_per_issued_policy_cents', round(net_spend_cents / nullif(issued_policies, 0), 2),
      'contact_rate_percent', round(100.0 * contacted_leads / nullif(leads_received, 0), 2)
    ) from totals),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.is_test_batch, r.cost_rank nulls last, r.net_spend_cents desc nulls last, r.vendor_name, r.campaign_name) from report_rows r), '[]'::jsonb),
    'vendor_rows', coalesce((select jsonb_agg(to_jsonb(v) order by v.is_test_batch, v.cost_rank nulls last, v.net_spend_cents desc nulls last, v.vendor_name) from vendor_rows v), '[]'::jsonb),
    'contact_rate_by_slot', coalesce((select jsonb_agg(jsonb_build_object('slot', slot, 'attempts', attempts, 'contacts', contacts, 'rate_percent', round(100.0 * contacts / nullif(attempts, 0), 2)) order by slot) from contact_by_slot), '[]'::jsonb),
    'attempts_to_contact', coalesce((select jsonb_agg(jsonb_build_object('attempt_number', attempt_number, 'attempts', attempts, 'contacts', contacts, 'rate_percent', round(100.0 * contacts / nullif(attempts, 0), 2), 'share_of_contacts_percent', share_of_contacts_percent) order by attempt_number) from attempts_shared), '[]'::jsonb),
    'filters', jsonb_build_object('vendor_id', p_vendor_id, 'campaign_id', p_campaign_id, 'product_code', p_product_code)
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text, integer) to service_role;

do $$
declare
  v_def text;
  v_report jsonb;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925708200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text)') is not null then
    raise exception 'the six-argument scorecard report is still there beside the new one';
  end if;
  select pg_get_functiondef('public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text, integer)'::regprocedure) into v_def;
  if v_def !~ 'greatest\(c\.total_spend_cents - c\.credits_received_cents, 0\)::numeric' then
    raise exception 'the scorecard does not split spend the way tenant_campaign_comparison does';
  end if;
  if has_function_privilege('tenant_app', 'public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text, integer)', 'execute')
     or has_function_privilege('anon', 'public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text, integer)', 'execute') then
    raise exception 'the scorecard report is callable outside the service role';
  end if;

  -- Runs, and an unknown tenant gets an empty, well-formed report.
  v_report := public.tenant_vendor_scorecard_report(gen_random_uuid(), null, null, null, null, null, 60);
  if jsonb_typeof(v_report -> 'vendor_rows') <> 'array' or jsonb_array_length(v_report -> 'rows') <> 0
     or (v_report ->> 'persist_days')::integer <> 60 or (v_report ->> 'from')::date <> current_date - 89 then
    raise exception 'the scorecard report did not return its new shape: %', v_report;
  end if;
  raise notice '20260925708200: vendor scorecard ranks by cost per issued policy, spend split by records received';
end $$;
