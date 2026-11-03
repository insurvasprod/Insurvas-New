-- LA-2.5 criterion 4: "Speed-to-lead is computed per vendor and visible."
-- LA-2.6 criterion 3: "Coverage per vendor is reported as a percentage."
--
-- Both were scored PASS on the existence of a view. Both views exist, both are correct, and a
-- repository-wide search finds **no reader for either** outside the audit document that scored
-- them. LA-2.5 is explicit about why that is not enough: the number is "shown to Ray as his own
-- number, because it is a number he can improve". A median nobody sees improves nothing.
--
-- This migration adds the one thing the screen actually needs and could not compute for itself,
-- and the next commit renders all three vendor answers together.
--
-- Why a separate vendor-level view rather than aggregating the campaign one:
--
--   `tenant_speed_to_lead` groups by (tenant, vendor, campaign) and returns a median per campaign.
--   A median cannot be averaged. Taking the mean of three campaign medians gives a number that is
--   not the median of anything, and a vendor with one tiny fast campaign would look fast overall.
--   This is the same trap the LA-2.1 vendor rollup calls out for cost — "summed then divided, never
--   an average of averages" — and the honest fix is the same: compute once over the vendor's own
--   leads.

-- Dropped first for the same reason as the cost views: `create or replace` cannot reorder an
-- existing view's columns, so a later change to this shape would fail with 42P16 rather than apply.
-- The grants and `security_invoker` are re-applied below.
drop view if exists public.tenant_vendor_speed_to_lead;

create or replace view public.tenant_vendor_speed_to_lead as
select
  l.tenant_id,
  c.vendor_id,
  count(*)::integer as posted_leads,
  count(l.first_dial_at)::integer as dialled_leads,

  -- The median, over this vendor's leads directly. `filter` excludes leads never dialled rather
  -- than counting them as zero seconds — an undialled lead has no speed-to-lead, and treating it
  -- as instant would make a vendor look better the more of its leads were ignored.
  percentile_cont(0.5) within group (
    order by extract(epoch from l.first_dial_at - l.posted_at)
  ) filter (where l.first_dial_at is not null) as median_seconds,

  count(*) filter (
    where l.first_dial_at is not null and (l.first_dial_at - l.posted_at) <= interval '1 minute'
  )::integer as dialled_within_60s,

  -- The share dialled inside a minute, as a percentage of leads POSTED, not of leads dialled.
  -- Over dialled leads it would report 100% for a vendor whose one answered lead was fast and
  -- whose other nine hundred were never called at all.
  round(
    100.0 * count(*) filter (
      where l.first_dial_at is not null and (l.first_dial_at - l.posted_at) <= interval '1 minute'
    ) / nullif(count(*), 0)
  , 1) as dialled_within_60s_pct
from public.agent_leads l
join public.tenant_campaigns c on c.id = l.campaign_id
-- Only real-time posted leads have a speed-to-lead. A list lead imported at 2am has an arrival
-- time that means nothing, and including it would bury the number this criterion is about.
where l.posted_at is not null
group by l.tenant_id, c.vendor_id;

revoke all on public.tenant_vendor_speed_to_lead from anon, authenticated, public;
grant select on public.tenant_vendor_speed_to_lead to tenant_app, service_role;

-- Runs with the caller's rights, so the RLS on `agent_leads` and `tenant_campaigns` applies. Without
-- this every tenant would read every other tenant's speed-to-lead.
alter view public.tenant_vendor_speed_to_lead set (security_invoker = on);

-- ── the arithmetic, asserted ───────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_vendor uuid;
  v_campaign uuid;
  v_median numeric;
  v_pct numeric;
  v_posted integer;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise notice 'LA-2.5 speed check skipped: no tenant in this database';
    return;
  end if;

  -- The view reads `agent_leads`, whose not-null columns come from the template contract, so this
  -- check verifies the arithmetic against a temporary view over a literal fixture instead of
  -- inserting leads. The expression under test is copied, not re-derived.
  create temporary table la_2_5_speed_fixture (posted_at timestamptz, first_dial_at timestamptz)
    on commit drop;
  insert into la_2_5_speed_fixture values
    (now(),                 now() + interval '30 seconds'),   -- inside a minute
    (now(),                 now() + interval '45 seconds'),   -- inside a minute
    (now(),                 now() + interval '10 minutes'),   -- dialled, but late
    (now(),                 null);                            -- never dialled

  select
    count(*)::integer,
    percentile_cont(0.5) within group (
      order by extract(epoch from first_dial_at - posted_at)
    ) filter (where first_dial_at is not null),
    round(100.0 * count(*) filter (
      where first_dial_at is not null and (first_dial_at - posted_at) <= interval '1 minute'
    ) / nullif(count(*), 0), 1)
  into v_posted, v_median, v_pct
  from la_2_5_speed_fixture;

  if v_posted <> 4 then
    raise exception 'LA-2.5: expected 4 posted leads, got %', v_posted;
  end if;

  -- Three dialled at 30s, 45s and 600s. The median of those is 45, NOT the mean of 225 — which is
  -- the entire reason the task asks for a median.
  if round(v_median) <> 45 then
    raise exception 'LA-2.5: expected a median of 45 seconds over dialled leads, got %', v_median;
  end if;

  -- Two of four POSTED leads were dialled inside a minute. Over dialled leads alone it would read
  -- 66.7%, which would flatter a vendor whose leads go uncalled.
  if v_pct <> 50.0 then
    raise exception 'LA-2.5: expected 50%% dialled within 60s over posted leads, got %', v_pct;
  end if;

  raise notice 'LA-2.5 speed check passed: median 45s over dialled, 50%% within 60s over posted';
end $$;
