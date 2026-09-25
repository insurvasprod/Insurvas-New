-- ---------------------------------------------------------------------------
-- Vendors · tenant_vendor_card — the facts about a vendor that only the vendor owns
--
-- The Vendors roster on /app/campaigns shows, per vendor, figures that belong to four different
-- owners. Each is read from its one definition and never recomputed here:
--   cost per issued policy     Scorecard   tenant_vendor_scorecard_report → vendor_rows
--   claimable $ + days left    Returns     vendor_returns_candidates_summary
--   undialable share           Returns     vendor_dispute_rates
--   certificate coverage       Scorecard   tenant_vendor_consent_coverage
-- What is left is the vendor's own: its status, renewal date, category label, how many campaigns
-- and leads it has — and from those, whether it is still TRIALLING.
--
-- Trialling (user decision 2026-09-25): a vendor with at least one campaign, and EITHER a single
-- campaign OR fewer than 200 leads across its campaigns. 200 is the campaign comparison's own
-- "too few to tell apart" threshold (tenant_campaign_comparison, 20260913430000), reused so the
-- product has one idea of "not enough to judge". A trialling vendor is never ranked and never
-- flagged. A vendor with no campaigns is neither trialling nor ranked: there is nothing to judge.
--
-- Leads are agent_leads rows attributed to the vendor's campaigns, counted through
-- agent_leads_campaign_idx. Read-only (STABLE). Additive: a new function.
-- ---------------------------------------------------------------------------

create or replace function public.tenant_vendor_card(p_tenant_id uuid)
returns table(
  vendor_id uuid,
  status text,
  category text,
  renews_on date,
  campaign_count integer,
  lead_count integer,
  trial_lead_threshold integer,
  trialling boolean
)
language sql
stable
security definer
set search_path = public
as $function$
  with campaigns as (
    select c.vendor_id, count(*)::integer as campaign_count
      from tenant_campaigns c
     where c.tenant_id = p_tenant_id
     group by c.vendor_id
  ),
  leads as (
    select c.vendor_id, count(l.id)::integer as lead_count
      from tenant_campaigns c
      join agent_leads l on l.tenant_id = c.tenant_id and l.campaign_id = c.id
     where c.tenant_id = p_tenant_id
     group by c.vendor_id
  )
  select v.id,
         v.status,
         v.category,
         v.renews_on,
         coalesce(k.campaign_count, 0),
         coalesce(n.lead_count, 0),
         200,
         coalesce(k.campaign_count, 0) >= 1
           and (coalesce(k.campaign_count, 0) = 1 or coalesce(n.lead_count, 0) < 200)
    from tenant_lead_vendors v
    left join campaigns k on k.vendor_id = v.id
    left join leads n on n.vendor_id = v.id
   where v.tenant_id = p_tenant_id
   order by v.name;
$function$;

revoke all on function public.tenant_vendor_card(uuid) from public, anon, authenticated;
grant execute on function public.tenant_vendor_card(uuid) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_tenant uuid;
  v_row record;
  v_vendors integer;
  v_rows integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925707100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef('public.tenant_vendor_card(uuid)'::regprocedure) into v_def;
  -- One idea of "not enough to judge": the comparison's 200.
  if strpos(v_def, '< 200') = 0 then
    raise exception 'tenant_vendor_card no longer uses the comparison''s 200-lead threshold';
  end if;
  if strpos(pg_get_functiondef('public.tenant_campaign_comparison(uuid, uuid, uuid, date, date, date, date, text)'::regprocedure), '< 200') = 0 then
    raise exception 'the campaign comparison changed its sample threshold; tenant_vendor_card must follow it';
  end if;

  -- One row per vendor of a real tenant, and the derivation holds on every row.
  select v.tenant_id into v_tenant from public.tenant_lead_vendors v limit 1;
  if v_tenant is not null then
    select count(*) into v_vendors from public.tenant_lead_vendors where tenant_id = v_tenant;
    select count(*) into v_rows from public.tenant_vendor_card(v_tenant);
    if v_rows <> v_vendors then
      raise exception 'tenant_vendor_card returned % rows for % vendors', v_rows, v_vendors;
    end if;
    for v_row in select * from public.tenant_vendor_card(v_tenant) loop
      if v_row.trialling <> (v_row.campaign_count >= 1 and (v_row.campaign_count = 1 or v_row.lead_count < 200)) then
        raise exception 'tenant_vendor_card: trialling disagrees with its own rule for vendor %', v_row.vendor_id;
      end if;
      if v_row.campaign_count = 0 and v_row.trialling then
        raise exception 'a vendor with no campaigns cannot be trialling';
      end if;
    end loop;
  end if;

  if not has_function_privilege('service_role', 'public.tenant_vendor_card(uuid)', 'execute') then
    raise exception 'service_role cannot execute tenant_vendor_card';
  end if;
  if has_function_privilege('anon', 'public.tenant_vendor_card(uuid)', 'execute') then
    raise exception 'anon can execute tenant_vendor_card';
  end if;
  raise notice '20260925707100: tenant_vendor_card answers status, renewal, category and whether a vendor is still trialling';
end $$;
