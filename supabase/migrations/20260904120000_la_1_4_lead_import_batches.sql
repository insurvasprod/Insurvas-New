-- LA-1.4: durable retry identity for agent lead CSV imports.
-- The UI supplies an idempotency key and the API also derives one when callers omit it.
-- A repeated request returns the stored result instead of creating another lead batch.

create table if not exists public.agent_lead_import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 1 and 200),
  created_by uuid not null references public.users(id) on delete restrict,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  response jsonb check (response is null or jsonb_typeof(response) = 'object'),
  error_message text check (error_message is null or char_length(error_message) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, idempotency_key)
);

create index if not exists agent_lead_import_batches_tenant_created_idx
  on public.agent_lead_import_batches (tenant_id, created_at desc);

alter table public.agent_lead_import_batches enable row level security;

drop policy if exists agent_lead_import_batches_scoped on public.agent_lead_import_batches;
create policy agent_lead_import_batches_scoped on public.agent_lead_import_batches
  for all to public
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on table public.agent_lead_import_batches from anon, authenticated;
grant select, insert, update on table public.agent_lead_import_batches to service_role;
grant select, insert, update on table public.agent_lead_import_batches to tenant_app;
