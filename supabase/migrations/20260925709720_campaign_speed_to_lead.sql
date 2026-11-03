-- ---------------------------------------------------------------------------
-- LA-2.5-5 · speed to lead per campaign, measured to the first Dial click
--
-- Spec: "Speed to lead (arrival -> first dial) per vendor/campaign: median and share within 60s."
-- Found: per vendor only (tenant_vendor_speed_to_lead), and that view reads agent_leads.first_dial_at,
-- which the dialer stamps when the lead is SERVED, not when Dial is clicked.
--
-- tenant_campaign_speed_to_lead: one row per campaign with real-time posted leads. The first dial is
-- the lead's earliest tenant_call_attempts.dial_clicked_at (markDialClicked stamps it only after
-- every dial gate passed), so the figure is arrival to the first real dial whatever first_dial_at
-- says. Same arithmetic as the vendor view: the median over dialled leads only, and the share within
-- a minute over leads POSTED, so ignored leads count against the campaign.
--
-- Read-only and additive. security_invoker, so the RLS on agent_leads, tenant_campaigns and
-- tenant_call_attempts applies to a tenant_app caller.
-- ---------------------------------------------------------------------------

drop view if exists public.tenant_campaign_speed_to_lead;

create view public.tenant_campaign_speed_to_lead with (security_invoker = on) as
select
  l.tenant_id,
  l.campaign_id,
  c.name as campaign_name,
  c.vendor_id,
  count(*)::integer as posted_leads,
  count(f.first_dial_at)::integer as dialled_leads,
  percentile_cont(0.5) within group (
    order by extract(epoch from f.first_dial_at - l.posted_at)
  ) filter (where f.first_dial_at is not null) as median_seconds,
  count(*) filter (
    where f.first_dial_at is not null and (f.first_dial_at - l.posted_at) <= interval '1 minute'
  )::integer as dialled_within_60s,
  round(
    100.0 * count(*) filter (
      where f.first_dial_at is not null and (f.first_dial_at - l.posted_at) <= interval '1 minute'
    ) / nullif(count(*), 0)
  , 1) as dialled_within_60s_pct,
  max(l.posted_at) as last_posted_at
from public.agent_leads l
join public.tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
left join lateral (
  select min(a.dial_clicked_at) as first_dial_at
    from public.tenant_call_attempts a
   where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.dial_clicked_at is not null
) f on true
where l.posted_at is not null
group by l.tenant_id, l.campaign_id, c.name, c.vendor_id;

revoke all on public.tenant_campaign_speed_to_lead from anon, authenticated, public;
grant select on public.tenant_campaign_speed_to_lead to tenant_app, service_role;

do $$
declare
  v_bad integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709720: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  -- Per campaign, the posted counts add up to the vendor view's per vendor.
  select count(*) into v_bad
    from public.tenant_vendor_speed_to_lead v
    left join (
      select tenant_id, vendor_id, sum(posted_leads)::integer as posted
        from public.tenant_campaign_speed_to_lead group by tenant_id, vendor_id
    ) c on c.tenant_id = v.tenant_id and c.vendor_id = v.vendor_id
   where coalesce(c.posted, 0) <> v.posted_leads;
  if v_bad > 0 then raise exception 'per-campaign posted leads disagree with the vendor view for % vendor(s)', v_bad; end if;
  -- A share is never above 100 and never counts an undialled lead.
  if exists (select 1 from public.tenant_campaign_speed_to_lead
              where dialled_within_60s > dialled_leads or dialled_leads > posted_leads or dialled_within_60s_pct > 100) then
    raise exception 'tenant_campaign_speed_to_lead counts are inconsistent';
  end if;
  raise notice '20260925709720: speed to lead per campaign, to the first Dial click';
end $$;
