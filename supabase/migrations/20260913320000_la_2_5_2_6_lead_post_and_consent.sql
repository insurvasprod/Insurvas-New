-- ---------------------------------------------------------------------------
-- LA-2.5 · Real-time lead post, and LA-2.6 · consent artefacts
--
-- Both are marked Completed, and both have a complete implementation — on the organizations-era
-- plane, which the tenant plane cannot see:
--
--   table/view                        keyed by         tenant_app can read
--   vendor_post_keys                  organization_id  no
--   lead_post_log                     organization_id  no
--   outbound_consent_artifacts        organization_id  no
--   consent_artefacts (a view on it)  both             no
--   outbound_vendor_consent_coverage  organization_id  no
--   outbound_campaign_speed_stats     organization_id  no
--   outbound_vendor_speed_rollups     organization_id  no
--
-- No application code references any of them except scripts/seed-demo-data.mjs, and there is no
-- `/api/leads/post/` route at all. On the tenant plane every criterion of both tasks fails.
--
-- That is the third and fourth time in this module — after LA-2.1 and LA-2.3 — so it is no longer a
-- surprise, it is the module's shape: LA-2 was built once against the CRM, and the tenant-era
-- application inherited the specification but not the software.
--
-- Two design points that are the tasks' own, not mine:
--
--   "Rejections are the billing mechanism."  A litigator hit or a duplicate returned as a rejection
--   is a lead the tenant does not pay for, so `reason_code` is a closed vocabulary rather than free
--   text. A vendor cannot dispute a code they cannot parse.
--
--   "flag, do not block"                     A lead with no consent certificate is recorded without
--   one and still served. Many legitimate lists have none, and suppressing them would quietly
--   throw away leads that were paid for.
-- ---------------------------------------------------------------------------

-- ── LA-2.5 · vendor post keys ──────────────────────────────────────────────
create table if not exists public.tenant_vendor_post_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vendor_id uuid not null references public.tenant_lead_vendors(id) on delete cascade,
  -- The key itself is never stored. `key_prefix` is the first few characters, kept so a person can
  -- tell two keys apart in a list without the secret being recoverable from the row.
  key_hash text not null unique,
  key_prefix text not null check (char_length(key_prefix) between 4 and 12),
  field_map jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  last_used_at timestamptz
);

create index if not exists tenant_vendor_post_keys_active_idx
  on public.tenant_vendor_post_keys (tenant_id, vendor_id) where is_active;

-- ── LA-2.5 · the post log ──────────────────────────────────────────────────
--
-- Every post, accepted or not. The rejections are the point: this is the record a vendor is billed
-- against, so it keeps the raw payload and the reason.
create table if not exists public.tenant_lead_post_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vendor_id uuid references public.tenant_lead_vendors(id) on delete set null,
  campaign_id uuid references public.tenant_campaigns(id) on delete set null,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome text not null check (outcome in ('accepted', 'rejected', 'error')),
  -- A closed vocabulary. A vendor disputing a rejection needs a code they can act on, and
  -- free text is not a code.
  reason_code text not null check (reason_code in (
    'accepted',
    'duplicate',              -- already have this person
    'suppressed_litigator',   -- TCPA litigator: never dialable, never paid for
    'suppressed_internal',    -- on the tenant's own do-not-call list
    'suppressed_dnc',         -- federal or state registry
    'invalid_phone',
    'missing_required_field',
    'unknown_state',
    'campaign_not_accepting', -- paused, exhausted, or not scrubbed
    'scrub_unavailable',      -- the scrub vendor is down: rejected, never accepted unscrubbed
    'rate_limited',
    'unauthorised'
  )),
  lead_id uuid references public.agent_leads(id) on delete set null,
  raw_payload jsonb not null,
  processing_ms integer,
  http_status integer not null,
  -- A vendor retrying a post must not create a second lead.
  idempotency_key text,
  unique (tenant_id, vendor_id, idempotency_key)
);

create index if not exists tenant_lead_post_log_vendor_idx
  on public.tenant_lead_post_log (tenant_id, vendor_id, received_at desc);

-- ── LA-2.5 · the real-time tier, and speed to lead ─────────────────────────
--
-- "Accepted leads enter the queue in the top tier, ahead of everything." A lower number sorts
-- first; list leads keep the default. A boolean would have worked today and been wrong the moment
-- LA-2.8 adds callbacks and appointments, which the module already says are their own tiers.
alter table public.lead_queue
  add column if not exists tier integer not null default 100;

comment on column public.lead_queue.tier is
  'Serving tier, lower first. 0 = real-time post (LA-2.5), 100 = list lead. LA-2.8 adds the tiers between.';

create index if not exists lead_queue_tier_idx
  on public.lead_queue (tenant_id, tier, queued_at) where status = 'unclaimed';

-- Arrival, and the first time anybody dialled. The metric the task says nobody currently measures.
alter table public.agent_leads
  add column if not exists posted_at timestamptz,
  add column if not exists first_dial_at timestamptz;

create index if not exists agent_leads_speed_idx
  on public.agent_leads (tenant_id, posted_at) where posted_at is not null;

-- Stamped once, by the first dial, and never moved. A second dial must not reset the clock.
create or replace function public.stamp_first_dial()
returns trigger
language plpgsql
as $function$
begin
  if new.first_dial_at is null then
    new.first_dial_at := now();
  end if;
  return new;
end;
$function$;

-- Speed to lead, per vendor: the median, and the share dialled inside a minute.
--
-- Median rather than mean, deliberately: one lead dialled four hours late because the agent went
-- home drags a mean into uselessness, while the median still answers "how fast is this normally".
-- The share under 60 seconds is the number that actually moves contact rate.
create or replace view public.tenant_speed_to_lead as
select
  l.tenant_id,
  c.vendor_id,
  l.campaign_id,
  count(*)::integer as posted_leads,
  count(l.first_dial_at)::integer as dialled_leads,
  percentile_cont(0.5) within group (
    order by extract(epoch from (l.first_dial_at - l.posted_at))
  ) filter (where l.first_dial_at is not null) as median_seconds,
  count(*) filter (
    where l.first_dial_at is not null
      and l.first_dial_at - l.posted_at <= interval '60 seconds'
  )::integer as dialled_within_60s
from public.agent_leads l
left join public.tenant_campaigns c on c.id = l.campaign_id
where l.posted_at is not null
group by l.tenant_id, c.vendor_id, l.campaign_id;

alter view public.tenant_speed_to_lead set (security_invoker = on);

-- ── LA-2.6 · consent artefacts ─────────────────────────────────────────────
create table if not exists public.tenant_consent_artefacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  provider text not null check (provider in ('trustedform', 'jornaya', 'other')),
  certificate_id text,
  certificate_url text,
  -- An unclaimed TrustedForm certificate expires. `claimed_at` is what says we still hold it.
  claimed_at timestamptz,
  -- The claimed copy, not just the link. "The stored copy survives the provider link expiring" is
  -- a criterion, and a URL is not a copy.
  stored_ref text,
  stored_copy jsonb,
  consent_timestamp timestamptz,
  ip text,
  source_url text,
  landing_page text,
  captured_at timestamptz not null default now(),
  -- pending  captured a URL, not yet claimed
  -- claimed  we hold the copy
  -- expired  the window closed before we claimed it
  -- failed   the provider refused
  capture_status text not null default 'pending'
    check (capture_status in ('pending', 'claimed', 'expired', 'failed')),
  capture_error text,
  unique (tenant_id, lead_id, provider)
);

create index if not exists tenant_consent_artefacts_lead_idx
  on public.tenant_consent_artefacts (tenant_id, lead_id);
create index if not exists tenant_consent_artefacts_unclaimed_idx
  on public.tenant_consent_artefacts (tenant_id, captured_at)
  where capture_status = 'pending';

-- Coverage per vendor, as a percentage. "A vendor who cannot supply certificates is selling
-- something different from what they claim" — and this is the number to take to a renewal.
--
-- Counted over every lead attributed to the vendor, not over the artefacts: a vendor supplying
-- certificates for three of a thousand leads has 0.3% coverage, and counting artefacts alone would
-- report 100%.
create or replace view public.tenant_vendor_consent_coverage as
select
  v.tenant_id,
  v.id as vendor_id,
  v.name as vendor_name,
  count(l.id)::integer as leads,
  count(a.id) filter (where a.capture_status = 'claimed')::integer as claimed_certificates,
  count(a.id) filter (where a.id is not null)::integer as any_certificate,
  round(
    100.0 * count(a.id) filter (where a.capture_status = 'claimed') / nullif(count(l.id), 0), 1
  ) as claimed_coverage_pct,
  round(
    100.0 * count(a.id) filter (where a.id is not null) / nullif(count(l.id), 0), 1
  ) as any_coverage_pct
from public.tenant_lead_vendors v
left join public.tenant_campaigns c on c.vendor_id = v.id and c.tenant_id = v.tenant_id
left join public.agent_leads l on l.campaign_id = c.id and l.tenant_id = v.tenant_id
left join public.tenant_consent_artefacts a on a.lead_id = l.id and a.tenant_id = v.tenant_id
group by v.tenant_id, v.id, v.name;

alter view public.tenant_vendor_consent_coverage set (security_invoker = on);

-- ── access ─────────────────────────────────────────────────────────────────
alter table public.tenant_vendor_post_keys enable row level security;
alter table public.tenant_lead_post_log enable row level security;
alter table public.tenant_consent_artefacts enable row level security;

do $$
declare t text;
begin
  foreach t in array array['tenant_vendor_post_keys', 'tenant_lead_post_log', 'tenant_consent_artefacts'] loop
    execute format('drop policy if exists %I on public.%I', t || '_tenant_scoped', t);
    execute format($p$
      create policy %I on public.%I
        for all to tenant_app
        using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
        with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
    $p$, t || '_tenant_scoped', t);
  end loop;
end $$;

revoke all on public.tenant_vendor_post_keys, public.tenant_lead_post_log, public.tenant_consent_artefacts
  from anon, authenticated, public;
revoke all on public.tenant_speed_to_lead, public.tenant_vendor_consent_coverage from anon, authenticated, public;

-- The key hash is never handed to the tenant plane's own role: reading it buys nothing and losing
-- it costs everything. Keys are managed through the service role.
grant select (id, tenant_id, vendor_id, key_prefix, field_map, is_active, created_at, rotated_at, last_used_at)
  on public.tenant_vendor_post_keys to tenant_app;
grant select on public.tenant_lead_post_log to tenant_app;
grant select, insert, update on public.tenant_consent_artefacts to tenant_app;
grant select on public.tenant_speed_to_lead, public.tenant_vendor_consent_coverage to tenant_app;

grant select, insert, update, delete on public.tenant_vendor_post_keys to service_role;
grant select, insert, update on public.tenant_lead_post_log to service_role;
grant select, insert, update, delete on public.tenant_consent_artefacts to service_role;
grant select on public.tenant_speed_to_lead, public.tenant_vendor_consent_coverage to service_role;
