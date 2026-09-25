-- SA-2.7: durable idempotency for subscription mutations.
-- This is deliberately a service-only ledger. It stores the final API response so a retry
-- can replay the original result without applying the lifecycle transition twice.

create table if not exists public.subscription_mutation_requests (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 1 and 200),
  operation text not null check (operation in (
    'subscription.assign',
    'subscription.change_plan',
    'subscription.cancel',
    'subscription.pause',
    'subscription.resume'
  )),
  resource_id uuid,
  request_hash text not null check (char_length(request_hash) = 64),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  response_status integer check (response_status between 100 and 599),
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (actor_id, idempotency_key)
);

create index if not exists subscription_mutation_requests_resource_idx
  on public.subscription_mutation_requests (resource_id, created_at desc)
  where resource_id is not null;

alter table public.subscription_mutation_requests enable row level security;

drop policy if exists subscription_mutation_requests_service_only on public.subscription_mutation_requests;
create policy subscription_mutation_requests_service_only
  on public.subscription_mutation_requests
  for all to service_role
  using (true)
  with check (true);

revoke all on public.subscription_mutation_requests from public, anon, authenticated, tenant_app;
grant all on public.subscription_mutation_requests to service_role;

comment on table public.subscription_mutation_requests is
  'SA-2.7 service-only idempotency ledger for subscription lifecycle requests; response rows are retained for audit and replay.';
