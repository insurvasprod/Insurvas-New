-- LA-4.11 (Notion sprint) · the policy list and the policy detail page.
--
-- Both screens read LA-4.7's policy_current; carrier-sourced fields are never written here, because
-- the carrier's file is the truth. Two small tables hold what is the agency's own:
--
--   policy_saved_filter  a person's named filters on the policy list (the list's query string). Each
--                        belongs to one user in one agency; nobody else sees them.
--   policy_annotation    the agency's own fields on a policy: notes, and a lead source when the sale
--                        did not come through us (vendor / campaign). Keyed like policy_current, so it
--                        survives every refresh. The contact link stays LA-4.8's (policy_match).
--
-- Additive. Requires 20261008160000 (policy_current).
--
-- Rollback:
--   drop table if exists public.policy_annotation, public.policy_saved_filter;

create table if not exists public.policy_saved_filter (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  query text not null,
  created_at timestamptz not null default now(),
  constraint policy_saved_filter_name check (char_length(btrim(name)) between 1 and 60),
  constraint policy_saved_filter_query check (char_length(query) <= 2000),
  constraint policy_saved_filter_key unique (tenant_id, user_id, name)
);
create index if not exists policy_saved_filter_user_idx on public.policy_saved_filter (user_id);

create table if not exists public.policy_annotation (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  notes text,
  lead_vendor_id uuid references public.tenant_lead_vendors(id) on delete set null,
  lead_campaign_id uuid references public.tenant_campaigns(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, carrier_id, policy_number),
  constraint policy_annotation_notes check (notes is null or char_length(notes) <= 4000)
);
create index if not exists policy_annotation_carrier_idx on public.policy_annotation (carrier_id);
create index if not exists policy_annotation_vendor_idx on public.policy_annotation (lead_vendor_id) where lead_vendor_id is not null;
create index if not exists policy_annotation_campaign_idx on public.policy_annotation (lead_campaign_id) where lead_campaign_id is not null;
create index if not exists policy_annotation_updated_by_idx on public.policy_annotation (updated_by) where updated_by is not null;

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.policy_saved_filter enable row level security;
alter table public.policy_annotation enable row level security;
drop policy if exists policy_saved_filter_read on public.policy_saved_filter;
create policy policy_saved_filter_read on public.policy_saved_filter for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists policy_annotation_read on public.policy_annotation;
create policy policy_annotation_read on public.policy_annotation for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.policy_saved_filter, public.policy_annotation from public, anon, authenticated;
revoke truncate on public.policy_saved_filter, public.policy_annotation from service_role, tenant_app;
grant select, insert, update, delete on public.policy_saved_filter, public.policy_annotation to service_role;
grant select on public.policy_saved_filter, public.policy_annotation to tenant_app;

do $$
begin
  if has_table_privilege('service_role', 'public.policy_annotation', 'TRUNCATE') then
    raise exception '20261008210000: policy notes must not be truncatable';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'policy_annotation' and policyname = 'policy_annotation_read') then
    raise exception '20261008210000: policy_annotation has no read policy';
  end if;
end $$;
