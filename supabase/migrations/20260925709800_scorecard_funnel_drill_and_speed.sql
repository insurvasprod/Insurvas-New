-- ---------------------------------------------------------------------------
-- LA-2.17 · the scorecard's funnel, cost per contact, drill-through and speed
-- (Module 2 fulfilment, LA-2.17-2 / -3 / -7 / -8 and LA-2.1-3)
--
-- Found 2026-09-25:
--   2.17-2  the funnel had no QUOTED stage, and "dialed" was attempts, not distinct leads dialled.
--   2.17-3  cost per lead, per application and per issued policy existed, but no cost per contact.
--   2.17-7  only campaign rows drilled, and the drill capped at 500 rows with no total, counting
--           every attempt of all time, so its rows summed to 522 attempts against the row's 4,964.
--   2.17-8  twelve months took 1.7 s for the report plus 1.8 s for vendor_return_metrics beside it.
--   2.1-3   the campaign list had no contacts figure anywhere.
--
-- One definition, used by all three readers:
--
--   tenant_vendor_scorecard_lead_facts   per lead in scope: attempts in the period, dialled,
--                                        contacted, quoted, applications, issued, lapsed, not yet
--                                        measurable, attribution warnings, undialable. Set-based
--                                        (grouped joins, no per-lead subqueries).
--   tenant_vendor_scorecard_report       restated from 20260925708200 over those facts. Same
--                                        signature, same keys, plus dialed_leads, quoted_leads,
--                                        applied_leads, undialable and claim figures (so the page no
--                                        longer needs vendor_return_metrics beside it) and
--                                        effective_cost_per_contact_cents. returns_included and
--                                        funnel_version say so to the app.
--   tenant_vendor_scorecard_drill        the rows behind ANY figure: a stage (received, dialable,
--                                        undialable, dialed, contacted, quoted, applied, issued) of
--                                        any scope (all, a vendor, a campaign), or an attempt number
--                                        or slot of the curves. Paged, with the total, has_more and
--                                        the sums of the whole selection, so the rows reconcile with
--                                        the figure that was clicked.
--   tenant_campaign_funnel               per campaign, all time: leads, dialable, dialled and
--                                        contacted leads, for /app/campaigns.
--
-- Definitions:
--   dialed      the lead has at least one call attempt in the period.
--   contacted   an attempt in the period ended in a contact disposition (is_contact_disposition).
--   quoted      a quote is recorded on the lead's deal in the period (initial quote or monthly
--               premium), or an application was opened in it: an application is quoted by
--               definition, so the funnel never shows fewer quoted than applied.
--   undialable  vendor_return_metrics' definition, unchanged: suppressed at screening (dnc,
--               litigator, invalid phone) or dispositioned wrong number / disconnected.
--   dialable    leads received less undialable.
--
-- No talk-time figure anywhere. Every function is service_role only, as the report always was.
-- ---------------------------------------------------------------------------

create or replace function public.tenant_vendor_scorecard_lead_facts(
  p_tenant_id uuid,
  p_from_date date,
  p_to_date date,
  p_vendor_id uuid default null,
  p_campaign_id uuid default null,
  p_product_code text default null,
  p_persist_days integer default null
)
returns table(
  lead_id uuid,
  campaign_id uuid,
  vendor_id uuid,
  lead_created_at timestamptz,
  product_line text,
  attempts integer,
  dialed boolean,
  contacted boolean,
  quoted boolean,
  applications integer,
  issued_policies integer,
  lapsed_policies integer,
  policies_not_yet_measurable integer,
  attribution_warnings integer,
  undialable boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with bounds as (
    select p_from_date::timestamptz as from_at, (p_to_date + 1)::timestamptz as to_at
  ),
  scoped_leads as (
    select l.id, l.campaign_id, c.vendor_id, l.created_at, l.product_line,
           l.screening_outcome, l.screening_result_id
      from agent_leads l
      join tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
     cross join bounds b
     where l.tenant_id = p_tenant_id
       and (p_vendor_id is null or c.vendor_id = p_vendor_id)
       and (p_campaign_id is null or c.id = p_campaign_id)
       and (p_product_code is null or l.product_line = p_product_code)
       and l.created_at >= b.from_at and l.created_at < b.to_at
  ),
  attempt_facts as (
    select a.lead_id,
           count(*) filter (where a.attempted_at >= b.from_at and a.attempted_at < b.to_at)::integer as attempts,
           coalesce(bool_or(a.attempted_at >= b.from_at and a.attempted_at < b.to_at
                            and a.disposition is not null and is_contact_disposition(a.disposition)), false) as contacted,
           coalesce(bool_or(a.disposition in ('wrong_number', 'disconnected')), false) as bad_number
      from tenant_call_attempts a
      join scoped_leads l on l.id = a.lead_id
     cross join bounds b
     where a.tenant_id = p_tenant_id
     group by a.lead_id
  ),
  case_facts as (
    select a.lead_id,
           count(*) filter (where a.status <> 'abandoned' and a.opened_at >= b.from_at and a.opened_at < b.to_at
                              and a.campaign_id is not distinct from l.campaign_id)::integer as applications,
           count(*) filter (where a.campaign_id is distinct from l.campaign_id)::integer as warnings
      from tenant_application_cases a
      join scoped_leads l on l.id = a.lead_id
     cross join bounds b
     where a.tenant_id = p_tenant_id
     group by a.lead_id
  ),
  policy_facts as (
    select p.lead_id,
           count(*) filter (where case
                when p_persist_days is null then p.status = 'issued'
                else p.issued_at <= now() - make_interval(days => p_persist_days)
                     and (p.status = 'issued'
                          or (p.status in ('lapsed', 'cancelled') and p.lapsed_at is not null
                              and p.lapsed_at >= p.issued_at + make_interval(days => p_persist_days)))
              end)::integer as issued_policies,
           count(*) filter (where p.status in ('lapsed', 'cancelled'))::integer as lapsed_policies,
           count(*) filter (where p_persist_days is not null
                              and p.issued_at > now() - make_interval(days => p_persist_days))::integer as not_yet
      from tenant_issued_policies p
      join scoped_leads l on l.id = p.lead_id
     cross join bounds b
     where p.tenant_id = p_tenant_id
       and p.issued_at >= b.from_at and p.issued_at < b.to_at
       and p.campaign_id is not distinct from l.campaign_id
     group by p.lead_id
  ),
  deal_facts as (
    select d.lead_id,
           count(*) filter (where d.campaign_id is distinct from l.campaign_id)::integer as warnings,
           coalesce(bool_or(d.created_at >= b.from_at and d.created_at < b.to_at
                            and (nullif(btrim(coalesce(d.initial_quote, '')), '') is not null
                                 or d.monthly_premium_cents is not null)), false) as quoted
      from deal_flow d
      join scoped_leads l on l.id = d.lead_id
     cross join bounds b
     where d.tenant_id = p_tenant_id
     group by d.lead_id
  )
  select l.id, l.campaign_id, l.vendor_id, l.created_at, l.product_line,
         coalesce(af.attempts, 0),
         coalesce(af.attempts, 0) > 0,
         coalesce(af.contacted, false),
         coalesce(df.quoted, false) or coalesce(cf.applications, 0) > 0,
         coalesce(cf.applications, 0),
         coalesce(pf.issued_policies, 0),
         coalesce(pf.lapsed_policies, 0),
         coalesce(pf.not_yet, 0),
         coalesce(cf.warnings, 0) + coalesce(df.warnings, 0),
         coalesce(coalesce(sr.outcome, l.screening_outcome) in ('dnc', 'tcpa_litigator', 'invalid_phone'), false)
           or coalesce(af.bad_number, false)
    from scoped_leads l
    left join attempt_facts af on af.lead_id = l.id
    left join case_facts cf on cf.lead_id = l.id
    left join policy_facts pf on pf.lead_id = l.id
    left join deal_facts df on df.lead_id = l.id
    left join screening_results sr on sr.id = l.screening_result_id and sr.tenant_id = p_tenant_id;
$function$;

revoke all on function public.tenant_vendor_scorecard_lead_facts(uuid, date, date, uuid, uuid, text, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_vendor_scorecard_lead_facts(uuid, date, date, uuid, uuid, text, integer) to service_role;

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
  lead_metrics as materialized (
    select f.* from tenant_vendor_scorecard_lead_facts(p_tenant_id, v_from, v_to, p_vendor_id, p_campaign_id, p_product_code, v_persist) f
  ),
  -- vendor_return_metrics' claim figures, verbatim: claims created in the period, not drafts.
  claim_stats as (
    select k.campaign_id,
      count(distinct k.id) filter (where k.status <> 'draft')::integer as claim_count,
      coalesce(sum(k.amount_claimed_cents) filter (where k.status <> 'draft'), 0)::integer as amount_claimed_cents,
      coalesce(sum(k.amount_credited_cents) filter (where k.status in ('accepted', 'partial')), 0)::integer as amount_credited_cents
      from lead_claims k
      join scoped_campaigns cp on cp.campaign_id = k.campaign_id
     where k.tenant_id = p_tenant_id
       and k.created_at >= v_from::timestamptz and k.created_at < (v_to + 1)::timestamptz
     group by k.campaign_id
  ),
  grouped as (
    select c.campaign_id, c.vendor_id, c.vendor_name, c.campaign_name,
      c.product_code, c.total_spend_cents, c.records_purchased, c.credits_received_cents,
      c.cost_per_record_cents, c.is_test_batch,
      (c.total_spend_cents - c.credits_received_cents) as lifetime_net_spend_cents,
      -- tenant_campaign_comparison's allocation, verbatim: spend follows the records received.
      round(greatest(c.total_spend_cents - c.credits_received_cents, 0)::numeric
        * count(l.lead_id) / nullif(c.records_purchased, 0), 2) as net_spend_cents,
      count(l.lead_id)::integer as leads_received,
      coalesce(sum(l.attempts), 0)::integer as attempts,
      (count(l.lead_id) filter (where l.dialed))::integer as dialed_leads,
      (count(l.lead_id) filter (where l.contacted))::integer as contacted_leads,
      (count(l.lead_id) filter (where l.quoted))::integer as quoted_leads,
      coalesce(sum(l.applications), 0)::integer as applications,
      (count(l.lead_id) filter (where l.applications > 0))::integer as applied_leads,
      coalesce(sum(l.issued_policies), 0)::integer as issued_policies,
      coalesce(sum(l.lapsed_policies), 0)::integer as lapsed_policies,
      coalesce(sum(l.policies_not_yet_measurable), 0)::integer as policies_not_yet_measurable,
      coalesce(sum(l.attribution_warnings), 0)::integer as attribution_warnings,
      (count(l.lead_id) filter (where l.undialable))::integer as undialable_leads
    from scoped_campaigns c
    left join lead_metrics l on l.campaign_id = c.campaign_id
    group by c.campaign_id, c.vendor_id, c.vendor_name, c.campaign_name, c.product_code,
             c.total_spend_cents, c.records_purchased, c.credits_received_cents,
             c.cost_per_record_cents, c.is_test_batch
  ),
  costed as (
    select g.*,
      g.leads_received - g.undialable_leads as dialable_leads,
      round(100.0 * g.undialable_leads / nullif(g.leads_received, 0), 2) as undialable_rate_percent,
      coalesce(k.claim_count, 0) as claim_count,
      coalesce(k.amount_claimed_cents, 0) as amount_claimed_cents,
      coalesce(k.amount_credited_cents, 0) as amount_credited_cents,
      round(100.0 * coalesce(k.amount_credited_cents, 0) / nullif(k.amount_claimed_cents, 0), 2) as claim_acceptance_rate_percent,
      round(g.net_spend_cents / nullif(g.leads_received, 0), 2) as effective_cost_per_lead_cents,
      round(g.net_spend_cents / nullif(g.contacted_leads, 0), 2) as effective_cost_per_contact_cents,
      round(g.net_spend_cents / nullif(g.applications, 0), 2) as effective_cost_per_application_cents,
      round(g.net_spend_cents / nullif(g.issued_policies, 0), 2) as effective_cost_per_issued_policy_cents,
      round(100.0 * g.contacted_leads / nullif(g.leads_received, 0), 2) as contact_rate_percent,
      (g.issued_policies between 1 and v_small_sample - 1) as small_sample
    from grouped g
    left join claim_stats k on k.campaign_id = g.campaign_id
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
      coalesce(sum(dialed_leads), 0)::integer as dialed_leads,
      coalesce(sum(contacted_leads), 0)::integer as contacted_leads,
      coalesce(sum(quoted_leads), 0)::integer as quoted_leads,
      coalesce(sum(applications), 0)::integer as applications,
      coalesce(sum(applied_leads), 0)::integer as applied_leads,
      coalesce(sum(issued_policies), 0)::integer as issued_policies,
      coalesce(sum(lapsed_policies), 0)::integer as lapsed_policies,
      coalesce(sum(policies_not_yet_measurable), 0)::integer as policies_not_yet_measurable,
      coalesce(sum(attribution_warnings), 0)::integer as attribution_warnings,
      coalesce(sum(undialable_leads), 0)::integer as undialable_leads,
      coalesce(sum(claim_count), 0)::integer as claim_count,
      coalesce(sum(amount_claimed_cents), 0)::bigint as amount_claimed_cents,
      coalesce(sum(amount_credited_cents), 0)::bigint as amount_credited_cents,
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
      coalesce(sum(b.dialed_leads), 0)::integer as dialed_leads,
      coalesce(sum(b.contacted_leads), 0)::integer as contacted_leads,
      coalesce(sum(b.quoted_leads), 0)::integer as quoted_leads,
      coalesce(sum(b.applications), 0)::integer as applications,
      coalesce(sum(b.applied_leads), 0)::integer as applied_leads,
      coalesce(sum(b.issued_policies), 0)::integer as issued_policies,
      coalesce(sum(b.lapsed_policies), 0)::integer as lapsed_policies,
      coalesce(sum(b.policies_not_yet_measurable), 0)::integer as policies_not_yet_measurable,
      coalesce(sum(b.attribution_warnings), 0)::integer as attribution_warnings,
      coalesce(sum(b.undialable_leads), 0)::integer as undialable_leads,
      coalesce(sum(b.amount_claimed_cents), 0)::bigint as amount_claimed_cents,
      coalesce(sum(b.amount_credited_cents), 0)::bigint as amount_credited_cents
      from vendor_basis b
     where b.is_test_batch = b.vendor_all_test
     group by b.vendor_id
  ),
  vendor_costed as (
    select g.*,
      (select count(*)::integer from report_rows r where r.vendor_id = g.vendor_id and r.is_test_batch) as test_batch_campaigns,
      round(g.total_spend_cents::numeric / nullif(g.records_purchased, 0), 2) as cost_per_record_cents,
      g.leads_received - g.undialable_leads as dialable_leads,
      round(100.0 * g.undialable_leads / nullif(g.leads_received, 0), 2) as undialable_rate_percent,
      round(100.0 * g.amount_credited_cents / nullif(g.amount_claimed_cents, 0), 2) as claim_acceptance_rate_percent,
      round(g.net_spend_cents / nullif(g.leads_received, 0), 2) as effective_cost_per_lead_cents,
      round(g.net_spend_cents / nullif(g.contacted_leads, 0), 2) as effective_cost_per_contact_cents,
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
  scoped_attempts as (
    select a.slot, a.attempt_number, a.disposition
      from tenant_call_attempts a
      join lead_metrics l on l.lead_id = a.lead_id
     where a.tenant_id = p_tenant_id
       and a.disposition is not null
       and a.attempted_at >= v_from::timestamptz and a.attempted_at < (v_to + 1)::timestamptz
  ),
  contact_by_slot as (
    select a.slot, count(*)::integer as attempts,
      count(*) filter (where is_contact_disposition(a.disposition))::integer as contacts
      from scoped_attempts a
     group by a.slot
  ),
  attempts_to_contact as (
    select a.attempt_number, count(*)::integer as attempts,
      count(*) filter (where is_contact_disposition(a.disposition))::integer as contacts
      from scoped_attempts a
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
    -- The page reads the undialable and claim figures from here and stops calling
    -- vendor_return_metrics beside it. funnel_version 2: dialed, quoted and cost per contact.
    'returns_included', true,
    'funnel_version', 2,
    'totals', (select jsonb_build_object(
      'campaigns', campaigns, 'test_batch_campaigns', test_batch_campaigns,
      'unallocated_spend_campaigns', unallocated_spend_campaigns,
      'net_spend_cents', net_spend_cents, 'lifetime_net_spend_cents', lifetime_net_spend_cents,
      'total_spend_cents', total_spend_cents, 'credits_received_cents', credits_received_cents,
      'records_purchased', records_purchased, 'leads_received', leads_received,
      'attempts', attempts, 'dialed_leads', dialed_leads, 'contacted_leads', contacted_leads,
      'quoted_leads', quoted_leads, 'applications', applications, 'applied_leads', applied_leads,
      'issued_policies', issued_policies, 'lapsed_policies', lapsed_policies,
      'policies_not_yet_measurable', policies_not_yet_measurable,
      'attribution_warnings', attribution_warnings,
      'undialable_leads', undialable_leads, 'dialable_leads', leads_received - undialable_leads,
      'undialable_rate_percent', round(100.0 * undialable_leads / nullif(leads_received, 0), 2),
      'claim_count', claim_count, 'amount_claimed_cents', amount_claimed_cents,
      'amount_credited_cents', amount_credited_cents,
      'claim_acceptance_rate_percent', round(100.0 * amount_credited_cents / nullif(amount_claimed_cents, 0), 2),
      'effective_cost_per_lead_cents', round(net_spend_cents / nullif(leads_received, 0), 2),
      'effective_cost_per_contact_cents', round(net_spend_cents / nullif(contacted_leads, 0), 2),
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

revoke all on function public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text, integer) to service_role;

create or replace function public.tenant_vendor_scorecard_drill(
  p_tenant_id uuid,
  p_from_date date,
  p_to_date date,
  p_vendor_id uuid default null,
  p_campaign_id uuid default null,
  p_product_code text default null,
  p_stage text default null,
  p_attempt_number integer default null,
  p_slot text default null,
  p_persist_days integer default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_stage text := coalesce(nullif(btrim(coalesce(p_stage, '')), ''), 'received');
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_result jsonb;
begin
  if p_from_date is null or p_to_date is null or p_from_date > p_to_date then
    raise exception 'vendor_scorecard_invalid_date_range';
  end if;
  if v_stage not in ('received', 'dialable', 'undialable', 'dialed', 'contacted', 'quoted', 'applied', 'issued') then
    raise exception 'vendor_scorecard_invalid_stage';
  end if;
  if p_persist_days is not null and (p_persist_days < 1 or p_persist_days > 730) then
    raise exception 'vendor_scorecard_invalid_persist_days';
  end if;

  with facts as materialized (
    select f.* from tenant_vendor_scorecard_lead_facts(p_tenant_id, p_from_date, p_to_date, p_vendor_id, p_campaign_id, p_product_code, p_persist_days) f
  ),
  -- The curves count attempts that ended with an outcome in the period, and their drill lists the leads
  -- behind one attempt number or one slot of that same count.
  curve as (
    select distinct a.lead_id
      from tenant_call_attempts a
      join facts f on f.lead_id = a.lead_id
     where (p_attempt_number is not null or p_slot is not null)
       and a.tenant_id = p_tenant_id
       and a.disposition is not null
       and a.attempted_at >= p_from_date::timestamptz and a.attempted_at < (p_to_date + 1)::timestamptz
       and (p_attempt_number is null or a.attempt_number = p_attempt_number)
       and (p_slot is null or a.slot = p_slot)
  ),
  picked as materialized (
    select f.*
      from facts f
     where (v_stage = 'received'
            or (v_stage = 'dialable' and not f.undialable)
            or (v_stage = 'undialable' and f.undialable)
            or (v_stage = 'dialed' and f.dialed)
            or (v_stage = 'contacted' and f.contacted)
            or (v_stage = 'quoted' and f.quoted)
            or (v_stage = 'applied' and f.applications > 0)
            or (v_stage = 'issued' and f.issued_policies > 0))
       and (p_attempt_number is null and p_slot is null or f.lead_id in (select c.lead_id from curve c))
  ),
  page as (
    select p.* from picked p order by p.lead_created_at desc, p.lead_id limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'stage', v_stage,
    'from', p_from_date, 'to', p_to_date,
    'total', (select count(*) from picked),
    'offset', v_offset,
    'limit', v_limit,
    'has_more', (select count(*) from picked) > v_offset + v_limit,
    'sums', (select jsonb_build_object(
      'leads', count(*),
      'attempts', coalesce(sum(p.attempts), 0),
      'dialed_leads', count(*) filter (where p.dialed),
      'contacted_leads', count(*) filter (where p.contacted),
      'quoted_leads', count(*) filter (where p.quoted),
      'applications', coalesce(sum(p.applications), 0),
      'issued_policies', coalesce(sum(p.issued_policies), 0),
      'undialable_leads', count(*) filter (where p.undialable)
    ) from picked p),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'lead_id', p.lead_id,
      'lead_date', p.lead_created_at::date,
      'product_line', p.product_line,
      'campaign_name', c.name,
      'vendor_name', v.name,
      'attempts', p.attempts,
      'contacts', case when p.contacted then 1 else 0 end,
      'dialed', p.dialed,
      'contacted', p.contacted,
      'quoted', p.quoted,
      'dialable', not p.undialable,
      'applications', p.applications,
      'issued_policies', p.issued_policies,
      'attribution_status', case when p.attribution_warnings > 0 then 'review attribution' else 'linked' end
    ) order by p.lead_created_at desc, p.lead_id)
      from page p
      join tenant_campaigns c on c.id = p.campaign_id and c.tenant_id = p_tenant_id
      join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = p_tenant_id), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.tenant_vendor_scorecard_drill(uuid, date, date, uuid, uuid, text, text, integer, text, integer, integer, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_vendor_scorecard_drill(uuid, date, date, uuid, uuid, text, text, integer, text, integer, integer, integer) to service_role;

-- /app/campaigns (LA-2.1-3): leads, dialable, dialled and contacted per campaign, all time, by the
-- scorecard's own definitions.
create or replace function public.tenant_campaign_funnel(p_tenant_id uuid)
returns table(campaign_id uuid, leads_received integer, dialable_leads integer, dialed_leads integer, contacted_leads integer, quoted_leads integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select f.campaign_id,
         count(*)::integer,
         (count(*) filter (where not f.undialable))::integer,
         (count(*) filter (where f.dialed))::integer,
         (count(*) filter (where f.contacted))::integer,
         (count(*) filter (where f.quoted))::integer
    from tenant_vendor_scorecard_lead_facts(p_tenant_id, date '2000-01-01', current_date, null, null, null, null) f
   group by f.campaign_id;
$function$;

revoke all on function public.tenant_campaign_funnel(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_campaign_funnel(uuid) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_report jsonb;
  v_drill jsonb;
  v_tenant uuid;
  v_from date := current_date - 364;
  v_row jsonb;
  v_rows integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709800: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if has_function_privilege('tenant_app', 'public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text, integer)', 'execute')
     or has_function_privilege('tenant_app', 'public.tenant_vendor_scorecard_drill(uuid, date, date, uuid, uuid, text, text, integer, text, integer, integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.tenant_campaign_funnel(uuid)', 'execute') then
    raise exception 'a scorecard function is callable outside the service role';
  end if;

  -- An unknown tenant gets an empty, well-formed report with the new keys.
  v_report := public.tenant_vendor_scorecard_report(gen_random_uuid(), null, null, null, null, null, 60);
  if (v_report ->> 'returns_included')::boolean is not true or (v_report ->> 'funnel_version')::integer <> 2
     or jsonb_array_length(v_report -> 'rows') <> 0 or not ((v_report -> 'totals') ? 'quoted_leads')
     or not ((v_report -> 'totals') ? 'effective_cost_per_contact_cents') then
    raise exception 'the scorecard report did not return its funnel shape: %', v_report;
  end if;

  -- On the busiest tenant with outbound leads: every campaign row's funnel is monotonic, and the
  -- drill behind one campaign's contacted figure has exactly that many leads.
  select l.tenant_id into v_tenant
    from agent_leads l where l.campaign_id is not null and l.created_at >= v_from::timestamptz
   group by l.tenant_id order by count(*) desc limit 1;
  if v_tenant is null then
    raise notice '20260925709800: no outbound leads anywhere, reconciliation skipped';
    return;
  end if;

  v_report := public.tenant_vendor_scorecard_report(v_tenant, v_from, current_date, null, null, null, null);
  for v_row in select value from jsonb_array_elements(v_report -> 'rows') loop
    if (v_row ->> 'dialed_leads')::integer > (v_row ->> 'leads_received')::integer
       or (v_row ->> 'contacted_leads')::integer > (v_row ->> 'dialed_leads')::integer
       or (v_row ->> 'applied_leads')::integer > (v_row ->> 'quoted_leads')::integer
       or (v_row ->> 'dialable_leads')::integer > (v_row ->> 'leads_received')::integer then
      raise exception 'the funnel is not monotonic for campaign %: %', v_row ->> 'campaign_name', v_row;
    end if;
    if (v_row ->> 'contacted_leads')::integer = 0 and (v_row ->> 'effective_cost_per_contact_cents') is not null then
      raise exception 'cost per contact is a number with no contacts for %', v_row ->> 'campaign_name';
    end if;
  end loop;

  select value into v_row from jsonb_array_elements(v_report -> 'rows')
   order by (value ->> 'contacted_leads')::integer desc limit 1;
  if v_row is not null then
    v_drill := public.tenant_vendor_scorecard_drill(v_tenant, v_from, current_date, null, (v_row ->> 'campaign_id')::uuid, null, 'contacted', null, null, null, 500, 0);
    if (v_drill ->> 'total')::integer <> (v_row ->> 'contacted_leads')::integer then
      raise exception 'the contacted drill has % leads, the row says %', v_drill ->> 'total', v_row ->> 'contacted_leads';
    end if;
    v_drill := public.tenant_vendor_scorecard_drill(v_tenant, v_from, current_date, null, (v_row ->> 'campaign_id')::uuid, null, 'received', null, null, null, 500, 0);
    if (v_drill -> 'sums' ->> 'attempts')::integer <> (v_row ->> 'attempts')::integer then
      raise exception 'the drill sums % attempts, the row says %', v_drill -> 'sums' ->> 'attempts', v_row ->> 'attempts';
    end if;
    v_rows := jsonb_array_length(v_drill -> 'rows');
    if v_rows > 500 or ((v_drill ->> 'total')::integer > 500 and (v_drill ->> 'has_more')::boolean is not true) then
      raise exception 'the drill does not say it has more rows than one page';
    end if;
  end if;
  raise notice '20260925709800: funnel, cost per contact and drill reconcile on tenant %', v_tenant;
end $$;
