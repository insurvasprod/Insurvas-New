-- ---------------------------------------------------------------------------
-- Scorecard · consent coverage counts each lead once
--
-- tenant_vendor_consent_coverage (20260913320000) joins every lead to its certificates and then
-- counts joined rows. tenant_consent_artefacts allows one certificate PER PROVIDER per lead
-- (unique (tenant_id, lead_id, provider)), so a lead that arrived with both a TrustedForm and a
-- Jornaya certificate was two "leads" and two "certificates". A vendor whose every lead carries
-- both read correctly by accident; a vendor with a mix read wrong in both the numerator and the
-- denominator.
--
-- Now every figure is a count of distinct LEADS:
--   leads                 leads attributed to the vendor
--   claimed_certificates  leads with at least one claimed (stored) certificate
--   any_certificate       leads with at least one certificate in any capture state
-- Same columns, same types, same order, so `create or replace` keeps the view and its dependants.
-- /app/campaigns and True CPA both read this one view.
-- ---------------------------------------------------------------------------

create or replace view public.tenant_vendor_consent_coverage as
select
  v.tenant_id,
  v.id as vendor_id,
  v.name as vendor_name,
  count(distinct l.id)::integer as leads,
  count(distinct l.id) filter (where a.capture_status = 'claimed')::integer as claimed_certificates,
  count(distinct l.id) filter (where a.id is not null)::integer as any_certificate,
  round(
    100.0 * count(distinct l.id) filter (where a.capture_status = 'claimed') / nullif(count(distinct l.id), 0), 1
  ) as claimed_coverage_pct,
  round(
    100.0 * count(distinct l.id) filter (where a.id is not null) / nullif(count(distinct l.id), 0), 1
  ) as any_coverage_pct
from public.tenant_lead_vendors v
left join public.tenant_campaigns c on c.vendor_id = v.id and c.tenant_id = v.tenant_id
left join public.agent_leads l on l.campaign_id = c.id and l.tenant_id = v.tenant_id
left join public.tenant_consent_artefacts a on a.lead_id = l.id and a.tenant_id = v.tenant_id
group by v.tenant_id, v.id, v.name;

-- Re-stated rather than trusted to survive: without security_invoker every tenant reads every
-- other tenant's coverage through this view.
alter view public.tenant_vendor_consent_coverage set (security_invoker = on);
revoke all on public.tenant_vendor_consent_coverage from anon, authenticated, public;
grant select on public.tenant_vendor_consent_coverage to tenant_app, service_role;

do $$
declare
  v_def text;
  v_options text[];
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925708100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  v_def := pg_get_viewdef('public.tenant_vendor_consent_coverage'::regclass);
  if v_def !~* 'count\(DISTINCT l\.id\)' then
    raise exception 'tenant_vendor_consent_coverage still counts joined rows, not leads';
  end if;
  select c.reloptions into v_options from pg_class c where c.oid = 'public.tenant_vendor_consent_coverage'::regclass;
  if v_options is null or not ('security_invoker=on' = any (v_options) or 'security_invoker=true' = any (v_options)) then
    raise exception 'tenant_vendor_consent_coverage lost security_invoker';
  end if;
  if has_table_privilege('anon', 'public.tenant_vendor_consent_coverage', 'select') then
    raise exception 'anon can read consent coverage';
  end if;
  raise notice '20260925708100: consent coverage counts each lead once';
end $$;
