-- LA-1.5: durable, non-billable accounting for TCPA-blocked partner submissions.
-- This is a separate append-only source because a blocked submission has no agent_leads row.
-- Store only the last four digits; never persist the rejected phone number here.

create table if not exists public.partner_rejected_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  user_id uuid references public.users(id) on delete set null,
  submission_id uuid not null,
  product_code text not null check (product_code ~ '^[a-z][a-z0-9_]{1,59}$'),
  reason text not null check (reason in ('tcpa_block')),
  phone_last4 text check (phone_last4 is null or phone_last4 ~ '^[0-9]{4}$'),
  screening_result_id uuid references public.screening_results(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, partner_id, submission_id, reason)
);

create index if not exists partner_rejected_submissions_partner_created_idx
  on public.partner_rejected_submissions (tenant_id, partner_id, created_at desc);

alter table public.partner_rejected_submissions enable row level security;
drop policy if exists partner_rejected_submissions_partner_read on public.partner_rejected_submissions;
create policy partner_rejected_submissions_partner_read
  on public.partner_rejected_submissions for select to tenant_app
  using (
    tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
    and partner_id = nullif((select current_setting('app.partner_id', true)), '')::uuid
  );

revoke all on public.partner_rejected_submissions from public, anon, authenticated, tenant_app;
grant select on public.partner_rejected_submissions to tenant_app;
grant select, insert on public.partner_rejected_submissions to service_role;

comment on table public.partner_rejected_submissions is
  'Append-only non-billable partner submission outcomes. Stores TCPA blocks without a full phone number; see 20260914140000.';
