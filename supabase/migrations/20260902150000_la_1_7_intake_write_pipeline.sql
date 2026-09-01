-- LA-1.7: make partner submission durable after the fatal lead insert.
-- The lead is the only fatal write. Queue, deal-flow and alert rows are best effort,
-- but every failure is retained for reconciliation instead of being swallowed.

alter table public.agent_leads
  add column if not exists submission_id uuid;

create unique index if not exists agent_leads_partner_submission_idx
  on public.agent_leads (tenant_id, partner_id, submission_id)
  where partner_id is not null and submission_id is not null;

create table if not exists public.lead_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete restrict,
  product_line text not null references public.products(code) on delete restrict,
  stage_key text not null,
  status text not null default 'unclaimed' check (status in ('unclaimed', 'claimed', 'completed', 'closed')),
  claimed_by uuid references public.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id)
);

create table if not exists public.deal_flow (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete restrict,
  submission_id uuid,
  product_line text not null references public.products(code) on delete restrict,
  stage_key text not null,
  insured_name text,
  phone text,
  initial_quote text,
  tracking_id text,
  local_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id)
);

create table if not exists public.intake_failures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  step text not null check (step in ('work_item', 'deal_flow', 'notification')),
  error_message text not null check (char_length(btrim(error_message)) between 1 and 2000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.intake_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  intake_failure_id uuid not null references public.intake_failures(id) on delete cascade,
  alert_type text not null default 'intake_failure',
  status text not null default 'open' check (status in ('open', 'acknowledged')),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

create index if not exists lead_queue_tenant_status_idx
  on public.lead_queue (tenant_id, status, created_at desc);
create index if not exists lead_queue_partner_idx
  on public.lead_queue (partner_id, created_at desc);
create unique index if not exists lead_queue_active_lead_idx
  on public.lead_queue (lead_id)
  where status in ('unclaimed', 'claimed');
create index if not exists deal_flow_tenant_product_idx
  on public.deal_flow (tenant_id, product_line, local_date desc);
create index if not exists deal_flow_partner_idx
  on public.deal_flow (partner_id, created_at desc);
create index if not exists intake_failures_open_idx
  on public.intake_failures (tenant_id, created_at desc)
  where resolved_at is null;
create index if not exists intake_alerts_open_idx
  on public.intake_alerts (tenant_id, created_at desc)
  where status = 'open';

create or replace function public.touch_intake_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists lead_queue_touch_updated_at on public.lead_queue;
create trigger lead_queue_touch_updated_at before update on public.lead_queue
for each row execute function public.touch_intake_updated_at();
drop trigger if exists deal_flow_touch_updated_at on public.deal_flow;
create trigger deal_flow_touch_updated_at before update on public.deal_flow
for each row execute function public.touch_intake_updated_at();

alter table public.lead_queue enable row level security;
alter table public.deal_flow enable row level security;
alter table public.intake_failures enable row level security;
alter table public.intake_alerts enable row level security;

drop policy if exists lead_queue_tenant_scoped on public.lead_queue;
create policy lead_queue_tenant_scoped on public.lead_queue
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists deal_flow_tenant_scoped on public.deal_flow;
create policy deal_flow_tenant_scoped on public.deal_flow
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists intake_failures_tenant_scoped on public.intake_failures;
create policy intake_failures_tenant_scoped on public.intake_failures
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists intake_alerts_tenant_scoped on public.intake_alerts;
create policy intake_alerts_tenant_scoped on public.intake_alerts
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.lead_queue, public.deal_flow, public.intake_failures, public.intake_alerts from anon, authenticated, public;
grant select, insert, update on public.lead_queue, public.deal_flow to tenant_app;
grant select on public.intake_failures, public.intake_alerts to tenant_app;
grant select, insert, update on public.lead_queue, public.deal_flow, public.intake_failures, public.intake_alerts to service_role;
revoke all on function public.touch_intake_updated_at() from public;
