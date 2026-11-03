-- ---------------------------------------------------------------------------
-- Campaigns · how far each campaign has been worked, and which cadence it runs
--
-- Campaigns concept audit (LA-2 §5, 2026-09-25). The concept board puts four facts on every campaign
-- row that /app/campaigns could not show, because nothing computed them per campaign:
--
--   leads_received   leads attributed to the campaign (agent_leads.campaign_id)
--   leads_dialed     of those, leads dialled at least once (attempts_made > 0) — "Worked %"
--   leads_workable   fresh, working or retry: what the dialer can still serve. The same set the lead
--                    list page calls workable (lib/leadLists/detail.ts WORKABLE), so the two screens
--                    agree. Nurture is not counted, matching that page, although a rested lead or an
--                    expired transfer is served again on its own when its rest ends (tier 6).
--   leads_exhausted  lead_state = 'exhausted'
--   first_import_at  when the first lead landed against it; last_import_at, the latest
--   own_cadence_rules  rows in tenant_cadence_rules for this campaign. More than zero means the
--                    campaign runs its own cadence, which replaces the tenant default entirely
--                    (schedule_next_attempt, 20260924230300).
--
-- A view, read through the service client and filtered by tenant, so nothing is stored twice. The
-- aggregate is grouped by (tenant_id, campaign_id); a tenant filter on the view is pushed into the
-- grouping and uses agent_leads_campaign_idx (tenant_id, campaign_id) where campaign_id is not null.
--
-- security_invoker so a tenant_app reader sees only what RLS on the base tables lets it see.
-- ---------------------------------------------------------------------------

create or replace view public.tenant_campaign_progress
with (security_invoker = on) as
select
  c.tenant_id,
  c.id as campaign_id,
  coalesce(l.leads_received, 0)::integer as leads_received,
  coalesce(l.leads_dialed, 0)::integer as leads_dialed,
  coalesce(l.leads_workable, 0)::integer as leads_workable,
  coalesce(l.leads_exhausted, 0)::integer as leads_exhausted,
  l.first_import_at,
  l.last_import_at,
  coalesce(r.own_cadence_rules, 0)::integer as own_cadence_rules
from public.tenant_campaigns c
left join (
  select a.tenant_id,
         a.campaign_id,
         count(*) as leads_received,
         count(*) filter (where coalesce(a.attempts_made, 0) > 0) as leads_dialed,
         count(*) filter (where a.lead_state in ('fresh', 'working', 'retry')) as leads_workable,
         count(*) filter (where a.lead_state = 'exhausted') as leads_exhausted,
         min(a.created_at) as first_import_at,
         max(a.created_at) as last_import_at
    from public.agent_leads a
   where a.campaign_id is not null
   group by a.tenant_id, a.campaign_id
) l on l.tenant_id = c.tenant_id and l.campaign_id = c.id
left join (
  select cr.tenant_id, cr.campaign_id, count(*) as own_cadence_rules
    from public.tenant_cadence_rules cr
   where cr.campaign_id is not null
   group by cr.tenant_id, cr.campaign_id
) r on r.tenant_id = c.tenant_id and r.campaign_id = c.id;

revoke all on public.tenant_campaign_progress from anon, authenticated, public;
grant select on public.tenant_campaign_progress to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_options text[];
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925706000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select c.reloptions into v_options
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'tenant_campaign_progress';
  if not found then
    raise exception 'tenant_campaign_progress was not created';
  end if;
  if v_options is null or not ('security_invoker=on' = any(v_options) or 'security_invoker=true' = any(v_options)) then
    raise exception 'tenant_campaign_progress must run with the reader''s rights (security_invoker)';
  end if;
  if has_table_privilege('anon', 'public.tenant_campaign_progress', 'select') then
    raise exception 'anon can read tenant_campaign_progress';
  end if;

  -- The columns the campaigns screen reads.
  perform leads_received, leads_dialed, leads_workable, leads_exhausted, first_import_at,
          last_import_at, own_cadence_rules
    from public.tenant_campaign_progress limit 0;
end $$;
