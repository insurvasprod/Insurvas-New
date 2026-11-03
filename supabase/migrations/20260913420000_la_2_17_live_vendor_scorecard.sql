-- ---------------------------------------------------------------------------
-- LA-2.17 · True CPA and vendor scorecard
--
-- Decision 10 replaces a nightly snapshot with a live report and incremental event counters. The
-- scorecard below is computed from the current tenant lineage at read time. The existing contact
-- rate counters remain incremental; all money and conversion facts are read from their source rows
-- so a credit, attribution repair, application, or issued policy is visible immediately.
--
-- This migration also adds the missing tenant-plane issued-policy event. The old `policies`-looking
-- tables belong to the organization-era CRM or to the E&O vault and cannot answer this question.
-- A fabricated policy count would make vendor selection worse than an honest empty report.
-- ---------------------------------------------------------------------------

create table if not exists public.tenant_issued_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  application_case_id uuid references public.tenant_application_cases(id) on delete set null,
  deal_id uuid references public.deal_flow(id) on delete set null,
  campaign_id uuid references public.tenant_campaigns(id) on delete set null,
  vendor_id uuid references public.tenant_lead_vendors(id) on delete set null,
  product_line text not null,
  carrier text not null check (char_length(btrim(carrier)) between 1 and 160),
  policy_number text,
  status text not null default 'issued' check (status in ('issued', 'lapsed', 'cancelled')),
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, carrier, policy_number)
);

create index if not exists tenant_issued_policies_scorecard_idx
  on public.tenant_issued_policies (tenant_id, campaign_id, issued_at desc)
  where status = 'issued';
create index if not exists tenant_issued_policies_lead_idx
  on public.tenant_issued_policies (tenant_id, lead_id, issued_at desc);

create or replace function public.enforce_issued_policy_attribution()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lead_tenant uuid;
  v_lead_campaign uuid;
  v_lead_product text;
  v_case_tenant uuid;
  v_case_lead uuid;
  v_case_campaign uuid;
  v_case_vendor uuid;
  v_case_product text;
  v_deal_tenant uuid;
  v_deal_lead uuid;
  v_deal_campaign uuid;
  v_deal_vendor uuid;
  v_deal_product text;
  v_campaign_tenant uuid;
  v_vendor_tenant uuid;
begin
  select l.tenant_id, l.campaign_id, l.product_line into v_lead_tenant, v_lead_campaign, v_lead_product
    from agent_leads l where l.id = new.lead_id;
  if not found or v_lead_tenant is distinct from new.tenant_id then
    raise exception 'ISSUED_POLICY_LEAD_TENANT_MISMATCH';
  end if;

  if new.application_case_id is not null then
    select c.tenant_id, c.lead_id, c.campaign_id, c.vendor_id, c.product_line
      into v_case_tenant, v_case_lead, v_case_campaign, v_case_vendor, v_case_product
      from tenant_application_cases c where c.id = new.application_case_id;
    if not found or v_case_tenant <> new.tenant_id or v_case_lead <> new.lead_id then
      raise exception 'ISSUED_POLICY_CASE_TENANT_MISMATCH';
    end if;
  end if;

  if new.deal_id is not null then
    select d.tenant_id, d.lead_id, d.campaign_id, d.vendor_id, d.product_line
      into v_deal_tenant, v_deal_lead, v_deal_campaign, v_deal_vendor, v_deal_product
      from deal_flow d where d.id = new.deal_id;
    if not found or v_deal_tenant <> new.tenant_id or v_deal_lead <> new.lead_id then
      raise exception 'ISSUED_POLICY_DEAL_TENANT_MISMATCH';
    end if;
  end if;

  -- An explicit attribution must agree with every known hop. Missing values are filled from the
  -- most specific event, then the lead. The policy keeps what was true when it was issued.
  new.campaign_id := coalesce(new.campaign_id,
    v_deal_campaign,
    v_case_campaign,
    v_lead_campaign);
  new.vendor_id := coalesce(new.vendor_id,
    v_deal_vendor,
    v_case_vendor);
  if new.vendor_id is null and new.campaign_id is not null then
    select c.vendor_id into new.vendor_id from tenant_campaigns c where c.id = new.campaign_id;
  end if;
  new.product_line := coalesce(nullif(btrim(new.product_line), ''), v_deal_product, v_case_product, v_lead_product);

  if new.campaign_id is not null then
    select tenant_id into v_campaign_tenant from tenant_campaigns where id = new.campaign_id;
    if v_campaign_tenant is distinct from new.tenant_id then raise exception 'ISSUED_POLICY_CAMPAIGN_TENANT_MISMATCH'; end if;
  end if;
  if new.vendor_id is not null then
    select tenant_id into v_vendor_tenant from tenant_lead_vendors where id = new.vendor_id;
    if v_vendor_tenant is distinct from new.tenant_id then raise exception 'ISSUED_POLICY_VENDOR_TENANT_MISMATCH'; end if;
  end if;

  if v_deal_campaign is not null and new.campaign_id is distinct from v_deal_campaign then raise exception 'ISSUED_POLICY_ATTRIBUTION_MISMATCH'; end if;
  if v_case_campaign is not null and new.campaign_id is distinct from v_case_campaign then raise exception 'ISSUED_POLICY_ATTRIBUTION_MISMATCH'; end if;
  return new;
end;
$function$;

drop trigger if exists tenant_issued_policies_attribution on public.tenant_issued_policies;
create trigger tenant_issued_policies_attribution
  before insert or update on public.tenant_issued_policies
  for each row execute function public.enforce_issued_policy_attribution();

alter table public.tenant_issued_policies enable row level security;
drop policy if exists tenant_issued_policies_tenant_scoped on public.tenant_issued_policies;
create policy tenant_issued_policies_tenant_scoped on public.tenant_issued_policies
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_issued_policies from anon, authenticated, public;
grant select on public.tenant_issued_policies to tenant_app;
grant select, insert, update on public.tenant_issued_policies to service_role;

create index if not exists agent_leads_scorecard_idx
  on public.agent_leads (tenant_id, campaign_id, created_at desc)
  where campaign_id is not null;
create index if not exists tenant_call_attempts_scorecard_idx
  on public.tenant_call_attempts (tenant_id, lead_id, attempted_at desc);
create index if not exists tenant_application_cases_scorecard_idx
  on public.tenant_application_cases (tenant_id, lead_id, opened_at desc);

create or replace function public.tenant_vendor_scorecard_report(
  p_tenant_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_vendor_id uuid default null,
  p_campaign_id uuid default null,
  p_product_code text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_from date := coalesce(p_from_date, (current_date - interval '11 months')::date);
  v_to date := coalesce(p_to_date, current_date);
  v_result jsonb;
begin
  if v_from > v_to then raise exception 'vendor_scorecard_invalid_date_range'; end if;

  with scoped_campaigns as (
    select c.id as campaign_id, c.vendor_id, c.name as campaign_name, c.product_code,
           c.total_spend_cents, c.records_purchased, c.credits_received_cents,
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
        where p.tenant_id = l.tenant_id and p.lead_id = l.id and p.status = 'issued'
          and p.issued_at >= v_from::timestamptz and p.issued_at < (v_to + 1)::timestamptz
          and p.campaign_id is not distinct from l.campaign_id) as issued_policies,
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
      (c.total_spend_cents - c.credits_received_cents) as net_spend_cents,
      count(l.id)::integer as leads_received,
      coalesce(sum(l.attempts), 0)::integer as attempts,
      coalesce(sum(l.contacted), 0)::integer as contacted_leads,
      coalesce(sum(l.applications), 0)::integer as applications,
      coalesce(sum(l.issued_policies), 0)::integer as issued_policies,
      coalesce(sum(l.attribution_warnings + l.deal_attribution_warnings), 0)::integer as attribution_warnings
    from scoped_campaigns c
    left join lead_metrics l on l.campaign_id = c.campaign_id
    group by c.campaign_id, c.vendor_id, c.vendor_name, c.campaign_name, c.product_code,
             c.total_spend_cents, c.records_purchased, c.credits_received_cents
  ),
  report_rows as (
    select g.*,
      round(g.net_spend_cents::numeric / nullif(g.leads_received, 0), 2) as effective_cost_per_lead_cents,
      round(g.net_spend_cents::numeric / nullif(g.applications, 0), 2) as effective_cost_per_application_cents,
      round(g.net_spend_cents::numeric / nullif(g.issued_policies, 0), 2) as effective_cost_per_issued_policy_cents,
      round(100.0 * g.contacted_leads / nullif(g.leads_received, 0), 2) as contact_rate_percent
    from grouped g
  ),
  totals as (
    select coalesce(sum(net_spend_cents), 0)::integer as net_spend_cents,
      coalesce(sum(total_spend_cents), 0)::integer as total_spend_cents,
      coalesce(sum(credits_received_cents), 0)::integer as credits_received_cents,
      coalesce(sum(records_purchased), 0)::integer as records_purchased,
      coalesce(sum(leads_received), 0)::integer as leads_received,
      coalesce(sum(attempts), 0)::integer as attempts,
      coalesce(sum(contacted_leads), 0)::integer as contacted_leads,
      coalesce(sum(applications), 0)::integer as applications,
      coalesce(sum(issued_policies), 0)::integer as issued_policies,
      coalesce(sum(attribution_warnings), 0)::integer as attribution_warnings,
      count(*)::integer as campaigns
    from report_rows
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
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'generated_at', now(),
    'live', true, 'snapshot', false,
    'totals', (select jsonb_build_object(
      'campaigns', campaigns, 'net_spend_cents', net_spend_cents,
      'total_spend_cents', total_spend_cents, 'credits_received_cents', credits_received_cents,
      'records_purchased', records_purchased, 'leads_received', leads_received,
      'attempts', attempts, 'contacted_leads', contacted_leads, 'applications', applications,
      'issued_policies', issued_policies, 'attribution_warnings', attribution_warnings,
      'effective_cost_per_lead_cents', round(net_spend_cents::numeric / nullif(leads_received, 0), 2),
      'effective_cost_per_application_cents', round(net_spend_cents::numeric / nullif(applications, 0), 2),
      'effective_cost_per_issued_policy_cents', round(net_spend_cents::numeric / nullif(issued_policies, 0), 2),
      'contact_rate_percent', round(100.0 * contacted_leads / nullif(leads_received, 0), 2)
    ) from totals),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.net_spend_cents desc, r.vendor_name, r.campaign_name) from report_rows r), '[]'::jsonb),
    'contact_rate_by_slot', coalesce((select jsonb_agg(jsonb_build_object('slot', slot, 'attempts', attempts, 'contacts', contacts, 'rate_percent', round(100.0 * contacts / nullif(attempts, 0), 2)) order by slot) from contact_by_slot), '[]'::jsonb),
    'attempts_to_contact', coalesce((select jsonb_agg(jsonb_build_object('attempt_number', attempt_number, 'attempts', attempts, 'contacts', contacts, 'rate_percent', round(100.0 * contacts / nullif(attempts, 0), 2)) order by attempt_number) from attempts_to_contact), '[]'::jsonb),
    'filters', jsonb_build_object('vendor_id', p_vendor_id, 'campaign_id', p_campaign_id, 'product_code', p_product_code)
  ) into v_result;
  return v_result;
end;
$function$;

create or replace function public.tenant_vendor_scorecard_leads(
  p_tenant_id uuid,
  p_from_date date,
  p_to_date date,
  p_vendor_id uuid,
  p_campaign_id uuid default null,
  p_product_code text default null,
  p_limit integer default 100
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object('rows', coalesce(jsonb_agg(to_jsonb(x) order by x.lead_date desc, x.lead_id), '[]'::jsonb))
    from (
      select l.id as lead_id, l.created_at::date as lead_date, l.product_line,
             c.name as campaign_name, v.name as vendor_name,
             (select count(*)::integer from tenant_call_attempts a where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.disposition is not null) as attempts,
             (select count(*)::integer from tenant_call_attempts a where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.disposition is not null and is_contact_disposition(a.disposition)) as contacts,
             (select count(*)::integer from tenant_application_cases a where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.status <> 'abandoned' and a.campaign_id is not distinct from l.campaign_id) as applications,
             (select count(*)::integer from tenant_issued_policies p where p.tenant_id = l.tenant_id and p.lead_id = l.id and p.status = 'issued' and p.campaign_id is not distinct from l.campaign_id) as issued_policies,
             case when exists (select 1 from tenant_application_cases a where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.campaign_id is distinct from l.campaign_id)
                    or exists (select 1 from deal_flow d where d.tenant_id = l.tenant_id and d.lead_id = l.id and d.campaign_id is distinct from l.campaign_id)
                  then 'review attribution' else 'linked' end as attribution_status
        from agent_leads l
        join tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
        join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = l.tenant_id
       where l.tenant_id = p_tenant_id and c.vendor_id = p_vendor_id
         and (p_campaign_id is null or c.id = p_campaign_id)
         and (p_product_code is null or l.product_line = p_product_code)
         and l.created_at >= p_from_date::timestamptz and l.created_at < (p_to_date + 1)::timestamptz
       order by l.created_at desc, l.id
       limit greatest(1, least(coalesce(p_limit, 100), 500))
    ) x;
$function$;

revoke all on function public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.tenant_vendor_scorecard_leads(uuid, date, date, uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text) to service_role;
grant execute on function public.tenant_vendor_scorecard_leads(uuid, date, date, uuid, uuid, text, integer) to service_role;

do $$
begin
  if to_regclass('public.tenant_issued_policies') is null then raise exception 'tenant_issued_policies did not land'; end if;
  if not exists (select 1 from pg_proc where proname = 'tenant_vendor_scorecard_report') then raise exception 'scorecard function did not land'; end if;
  raise notice 'LA-2.17: live vendor scorecard and issued-policy attribution are in place';
end $$;
