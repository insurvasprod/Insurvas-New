-- ---------------------------------------------------------------------------
-- LA-2.1 · Lead vendors and campaigns, on the tenant plane
--
-- The board marks LA-2.1 Completed, and its own notes say "campaigns already exist and are
-- reasonable" with two small gaps — no cost-per-lead metric, no vendor rollup. That reading is of
-- the WRONG LINEAGE. The tables it describes are the organizations-era CRM's:
--
--   lead_vendors      organization_id, 1 row,    tenant_app cannot read it
--   lead_campaigns    organization_id, 1 row,    tenant_app cannot read it
--   leads             organization_id, 3 rows
--
-- while this application's lead table is `agent_leads` — tenant_id, 1,521 rows, and referenced by
-- every service in lib/. No application code touches lead_vendors or lead_campaigns at all.
--
-- So on the tenant plane LA-2.1 is not two gaps. There are no vendors, no campaigns, no campaign_id
-- on a lead, and none of the money. All five acceptance criteria fail, and the four LA-2 tasks that
-- depend on this one (2.2, 2.3, 2.4, 2.5) have nothing to build against.
--
-- This is the ninth instance of the two-lineage confusion recorded in backlog 182, and the first
-- one found by reading a spec rather than by a failing test.
--
-- Naming follows the precedent set by SA-3 and LA-1.21/1.22: this application's table takes the
-- distinct name and nothing outside this repo changes. The CRM's lead_vendors and lead_campaigns
-- are left exactly as they are.
-- ---------------------------------------------------------------------------

-- ── vendors ────────────────────────────────────────────────────────────────
create table if not exists public.tenant_lead_vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  -- The spec's three kinds. Open vocabulary would let a typo create a fourth silently.
  lead_type text not null check (lead_type in ('list', 'realtime', 'aged')),
  contact jsonb not null default '{}'::jsonb,
  terms text,
  -- The return window is the whole point of tracking a vendor: LA-2.19 cannot decide whether a
  -- credit claim is still open without it.
  return_window_days integer not null default 0 check (return_window_days >= 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

-- ── campaigns ──────────────────────────────────────────────────────────────
create table if not exists public.tenant_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vendor_id uuid not null references public.tenant_lead_vendors(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  lead_type text not null check (lead_type in ('list', 'realtime', 'aged')),
  product_code text,
  -- Two-letter codes, empty meaning "no restriction". An array rather than a join table because
  -- nothing needs to query campaigns BY state, only to read a campaign's states.
  target_states text[] not null default '{}'::text[],
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'exhausted')),

  total_spend_cents integer not null default 0 check (total_spend_cents >= 0),
  records_purchased integer not null default 0 check (records_purchased >= 0),
  credits_received_cents integer not null default 0 check (credits_received_cents >= 0),

  -- Both costs are DERIVED, never stored as a third number that can disagree with the two it comes
  -- from. Criterion 2 — "effective cost per record changes when a credit is recorded" — is then
  -- true by construction rather than by a service remembering to recompute.
  --
  -- nullif guards the division: a campaign with no records yet has no cost per record, and null is
  -- the honest answer. Zero would read as "these leads were free".
  cost_per_record_cents numeric generated always as (
    total_spend_cents::numeric / nullif(records_purchased, 0)
  ) stored,
  effective_cost_per_record_cents numeric generated always as (
    (total_spend_cents - credits_received_cents)::numeric / nullif(records_purchased, 0)
  ) stored,

  -- Relative, not a percentage: weights 4 and 2 serve 2:1, which is criterion 5. Zero would mean
  -- "never serve", which is what `paused` is for, so the floor is 1.
  mixing_weight integer not null default 1 check (mixing_weight >= 1),

  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paused_at timestamptz,
  unique (tenant_id, name)
);

-- A campaign belongs to a vendor of the same tenant. A foreign key alone cannot say that, and a
-- campaign pointing at another tenant's vendor is a cross-tenant leak in the cost reporting.
create or replace function public.enforce_campaign_vendor_tenant()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_vendor_tenant uuid;
begin
  select tenant_id into v_vendor_tenant
    from public.tenant_lead_vendors where id = new.vendor_id;
  if not found then
    raise exception 'The campaign vendor does not exist.';
  end if;
  if v_vendor_tenant <> new.tenant_id then
    raise exception 'The campaign vendor belongs to another tenant.';
  end if;
  return new;
end;
$function$;

drop trigger if exists tenant_campaigns_vendor_tenant_guard on public.tenant_campaigns;
create trigger tenant_campaigns_vendor_tenant_guard
  before insert or update of vendor_id, tenant_id on public.tenant_campaigns
  for each row execute function public.enforce_campaign_vendor_tenant();

-- `paused_at` must agree with `status`, or "when was this paused" becomes unanswerable and the
-- pause itself becomes hard to audit.
create or replace function public.stamp_campaign_paused_at()
returns trigger
language plpgsql
as $function$
begin
  if new.status = 'paused' and (old is null or old.status <> 'paused') then
    new.paused_at := now();
  elsif new.status <> 'paused' then
    new.paused_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists tenant_campaigns_paused_at on public.tenant_campaigns;
create trigger tenant_campaigns_paused_at
  before insert or update on public.tenant_campaigns
  for each row execute function public.stamp_campaign_paused_at();

-- ── the column everything downstream depends on ────────────────────────────
--
-- "campaign_id travels with the lead forever — onto the application, onto the policy. One column at
-- each hop." Without it LA-2.17 cannot compute cost per issued policy, which is the number that
-- decides which vendor to buy from next month.
--
-- Nullable, because 1,521 leads already exist and did not come from a campaign. A NOT NULL column
-- would require inventing a campaign for every one of them, and a fabricated attribution is worse
-- than an honest absence.
alter table public.agent_leads
  add column if not exists campaign_id uuid references public.tenant_campaigns(id) on delete set null;

create index if not exists agent_leads_campaign_idx
  on public.agent_leads (tenant_id, campaign_id) where campaign_id is not null;

create index if not exists tenant_campaigns_serving_idx
  on public.tenant_campaigns (tenant_id, status, mixing_weight desc) where status = 'active';

create index if not exists tenant_lead_vendors_tenant_idx
  on public.tenant_lead_vendors (tenant_id, status);

-- ── the vendor rollup (criterion 4) ────────────────────────────────────────
--
-- A view, not a table. Criterion 4 says the rollup "sums its campaigns correctly"; a stored rollup
-- is a fourth number that can disagree with the three it came from, and keeping it in step is a job
-- nobody would remember to do. The campaign row count is small per tenant.
create or replace view public.tenant_vendor_rollup as
select
  v.tenant_id,
  v.id as vendor_id,
  v.name as vendor_name,
  v.lead_type,
  v.status,
  v.return_window_days,
  count(c.id)::integer as campaign_count,
  count(c.id) filter (where c.status = 'active')::integer as active_campaign_count,
  coalesce(sum(c.total_spend_cents), 0)::integer as total_spend_cents,
  coalesce(sum(c.records_purchased), 0)::integer as records_purchased,
  coalesce(sum(c.credits_received_cents), 0)::integer as credits_received_cents,
  -- Summed then divided, never an average of averages: a campaign that bought 10 records and one
  -- that bought 10,000 must not count equally toward the vendor's cost per record.
  (coalesce(sum(c.total_spend_cents), 0)::numeric
     / nullif(coalesce(sum(c.records_purchased), 0), 0)) as cost_per_record_cents,
  ((coalesce(sum(c.total_spend_cents), 0) - coalesce(sum(c.credits_received_cents), 0))::numeric
     / nullif(coalesce(sum(c.records_purchased), 0), 0)) as effective_cost_per_record_cents
from public.tenant_lead_vendors v
left join public.tenant_campaigns c on c.vendor_id = v.id and c.tenant_id = v.tenant_id
group by v.tenant_id, v.id, v.name, v.lead_type, v.status, v.return_window_days;

-- ── row security and grants ────────────────────────────────────────────────
alter table public.tenant_lead_vendors enable row level security;
alter table public.tenant_campaigns enable row level security;

drop policy if exists tenant_lead_vendors_tenant_scoped on public.tenant_lead_vendors;
create policy tenant_lead_vendors_tenant_scoped on public.tenant_lead_vendors
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

drop policy if exists tenant_campaigns_tenant_scoped on public.tenant_campaigns;
create policy tenant_campaigns_tenant_scoped on public.tenant_campaigns
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_lead_vendors, public.tenant_campaigns from anon, authenticated, public;
revoke all on public.tenant_vendor_rollup from anon, authenticated, public;

grant select, insert, update on public.tenant_lead_vendors to tenant_app;
grant select, insert, update on public.tenant_campaigns to tenant_app;
grant select on public.tenant_vendor_rollup to tenant_app;
grant select, insert, update, delete on public.tenant_lead_vendors, public.tenant_campaigns to service_role;
grant select on public.tenant_vendor_rollup to service_role;

-- The view runs with the querying role's rights, so the RLS on the tables underneath applies to it.
-- Without this it would run as its owner and every tenant would see every other tenant's spend.
alter view public.tenant_vendor_rollup set (security_invoker = on);

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_vendor uuid;
  v_a uuid;
  v_b uuid;
  v_cost numeric;
  v_effective numeric;
  v_rollup record;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise notice 'no tenant exists, so the end-to-end assertion was skipped';
    return;
  end if;

  insert into public.tenant_lead_vendors (tenant_id, name, lead_type, return_window_days)
  values (v_tenant, 'Migration self-check vendor', 'list', 30)
  returning id into v_vendor;

  -- 1,000 records for $2,000.00 => 200 cents each.
  insert into public.tenant_campaigns
    (tenant_id, vendor_id, name, lead_type, total_spend_cents, records_purchased, mixing_weight)
  values (v_tenant, v_vendor, 'Self-check A', 'list', 200000, 1000, 4)
  returning id into v_a;

  insert into public.tenant_campaigns
    (tenant_id, vendor_id, name, lead_type, total_spend_cents, records_purchased, mixing_weight)
  values (v_tenant, v_vendor, 'Self-check B', 'list', 100000, 500, 2)
  returning id into v_b;

  select cost_per_record_cents, effective_cost_per_record_cents
    into v_cost, v_effective from public.tenant_campaigns where id = v_a;
  if v_cost <> 200 then raise exception 'cost per record was % rather than 200', v_cost; end if;
  if v_effective <> 200 then raise exception 'effective cost started at % rather than 200', v_effective; end if;

  -- Criterion 2: a credit moves the effective cost, and only the effective one.
  update public.tenant_campaigns set credits_received_cents = 50000 where id = v_a;
  select cost_per_record_cents, effective_cost_per_record_cents
    into v_cost, v_effective from public.tenant_campaigns where id = v_a;
  if v_cost <> 200 then raise exception 'a credit moved the GROSS cost to %; it must not', v_cost; end if;
  if v_effective <> 150 then raise exception 'effective cost after a $500 credit was % rather than 150', v_effective; end if;

  -- Criterion 4: the rollup sums, and divides the sums rather than averaging the averages.
  select * into v_rollup from public.tenant_vendor_rollup where vendor_id = v_vendor;
  if v_rollup.campaign_count <> 2 then raise exception 'rollup counted % campaigns', v_rollup.campaign_count; end if;
  if v_rollup.total_spend_cents <> 300000 then raise exception 'rollup spend was %', v_rollup.total_spend_cents; end if;
  if v_rollup.records_purchased <> 1500 then raise exception 'rollup records was %', v_rollup.records_purchased; end if;
  if v_rollup.cost_per_record_cents <> 200 then raise exception 'rollup cost per record was %', v_rollup.cost_per_record_cents; end if;
  -- (300000 - 50000) / 1500 = 166.67, not the mean of 150 and 200 (175).
  if round(v_rollup.effective_cost_per_record_cents, 2) <> 166.67 then
    raise exception 'rollup effective cost was % — an average of averages would give 175',
      round(v_rollup.effective_cost_per_record_cents, 2);
  end if;

  -- paused_at tracks status.
  update public.tenant_campaigns set status = 'paused' where id = v_b;
  if (select paused_at from public.tenant_campaigns where id = v_b) is null then
    raise exception 'pausing did not stamp paused_at';
  end if;
  update public.tenant_campaigns set status = 'active' where id = v_b;
  if (select paused_at from public.tenant_campaigns where id = v_b) is not null then
    raise exception 'un-pausing did not clear paused_at';
  end if;

  -- A campaign may not borrow another tenant's vendor.
  begin
    insert into public.tenant_campaigns (tenant_id, vendor_id, name, lead_type)
    values (gen_random_uuid(), v_vendor, 'Self-check cross-tenant', 'list');
    raise exception 'a campaign was allowed to use another tenant''s vendor';
  exception when foreign_key_violation or raise_exception then
    null;
  end;

  delete from public.tenant_campaigns where tenant_id = v_tenant and name like 'Self-check %';
  delete from public.tenant_lead_vendors where id = v_vendor;
exception when others then
  delete from public.tenant_campaigns where name like 'Self-check %';
  if v_vendor is not null then delete from public.tenant_lead_vendors where id = v_vendor; end if;
  raise;
end $$;

-- The CRM's tables are untouched.
do $$
begin
  if (select count(*) from public.lead_vendors) <> 1 then
    raise exception 'the CRM lead_vendors table changed';
  end if;
  if (select count(*) from public.lead_campaigns) <> 1 then
    raise exception 'the CRM lead_campaigns table changed';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'agent_leads' and column_name = 'campaign_id') then
    raise exception 'agent_leads.campaign_id was not added';
  end if;
end $$;
