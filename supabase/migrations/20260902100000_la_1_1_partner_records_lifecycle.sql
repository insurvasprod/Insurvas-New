-- LA-1.1: one tenant-scoped partner record for publishers, marketing companies and affiliates.
-- There is intentionally no delete path. Offboarding revokes access while preserving every
-- partner, term and lead reference for accounting and audit history.

do $$ begin
  create type public.partner_type as enum ('publisher', 'marketing', 'affiliate');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.partner_status as enum ('draft', 'active', 'paused', 'offboarded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.partner_payout_model as enum ('per_transfer', 'per_lead', 'per_sale', 'per_issued_policy', 'revenue_share');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.partner_user_status as enum ('active', 'revoked');
exception when duplicate_object then null; end $$;

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  partner_type public.partner_type not null,
  status public.partner_status not null default 'draft',
  country text not null default 'US',
  contact_name text,
  contact_email text,
  timezone text not null default 'UTC',
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paused_at timestamptz,
  offboarded_at timestamptz,
  constraint partners_name_length check (char_length(btrim(name)) between 1 and 200),
  constraint partners_country_length check (char_length(btrim(country)) between 2 and 2),
  constraint partners_contact_name_length check (contact_name is null or char_length(contact_name) <= 200),
  constraint partners_contact_email_format check (contact_email is null or contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'),
  constraint partners_timezone_length check (char_length(timezone) between 1 and 100),
  constraint partners_notes_length check (notes is null or char_length(notes) <= 5000),
  constraint partners_status_dates check (
    (status <> 'paused' or paused_at is not null) and
    (status <> 'offboarded' or offboarded_at is not null)
  )
);

create table if not exists public.partner_terms (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete restrict,
  payout_model public.partner_payout_model not null,
  rate_cents bigint,
  rate_pct_bp integer,
  effective_from date not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint partner_terms_rate_shape check (
    (payout_model = 'revenue_share' and rate_cents is null and rate_pct_bp between 1 and 10000) or
    (payout_model <> 'revenue_share' and rate_cents >= 0 and rate_pct_bp is null)
  ),
  constraint partner_terms_partner_date_unique unique (partner_id, effective_from)
);

-- LA-1.2 will add the portal invite flow. This membership table exists now so LA-1.1 can revoke
-- every partner login atomically without deactivating a user who may belong to another partner or
-- tenant. The future partner auth guard must require status = 'active'.
create table if not exists public.partner_users (
  partner_id uuid not null references public.partners(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  status public.partner_user_status not null default 'active',
  invited_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (partner_id, user_id),
  constraint partner_users_status_dates check (status <> 'revoked' or revoked_at is not null)
);

alter table public.agent_leads add column if not exists partner_id uuid;
do $$ begin
  alter table public.agent_leads add constraint agent_leads_partner_id_fkey
    foreign key (partner_id) references public.partners(id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists partners_tenant_status_idx on public.partners(tenant_id, status, created_at desc);
create index if not exists partner_terms_partner_effective_idx on public.partner_terms(partner_id, effective_from desc);
create index if not exists partner_users_partner_status_idx on public.partner_users(partner_id, status);
create index if not exists agent_leads_partner_created_idx on public.agent_leads(partner_id, created_at desc) where partner_id is not null;

create or replace function public.touch_partner_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists partners_touch_updated_at on public.partners;
create trigger partners_touch_updated_at before update on public.partners
for each row execute function public.touch_partner_updated_at();

create or replace function public.create_partner(
  p_tenant_id uuid,
  p_name text,
  p_partner_type public.partner_type,
  p_country text,
  p_contact_name text,
  p_contact_email text,
  p_timezone text,
  p_notes text,
  p_created_by uuid,
  p_max_partners integer default null
)
returns public.partners
language plpgsql security invoker set search_path = public
as $$
declare
  v_row public.partners;
  v_count integer;
begin
  -- The advisory lock makes the allowance check safe even when the HTTP calls land on different
  -- pooler connections. The tenant row lock below keeps the tenant aggregate serialized too.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  perform 1 from public.tenants where id = p_tenant_id for update;
  if not found then raise exception 'tenant_not_found'; end if;
  if p_max_partners is not null and p_max_partners < 0 then raise exception 'invalid_partner_limit'; end if;

  select count(*)::integer into v_count from public.partners
  where tenant_id = p_tenant_id and status <> 'offboarded';
  if p_max_partners is not null and v_count >= p_max_partners then
    raise exception 'partner_limit_reached:%:%', v_count, p_max_partners;
  end if;

  insert into public.partners (tenant_id, name, partner_type, country, contact_name, contact_email, timezone, notes, created_by)
  values (p_tenant_id, btrim(p_name), p_partner_type, upper(btrim(p_country)), nullif(btrim(p_contact_name), ''), nullif(lower(btrim(p_contact_email)), ''), btrim(p_timezone), nullif(btrim(p_notes), ''), p_created_by)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.update_partner(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_name text,
  p_partner_type public.partner_type,
  p_country text,
  p_contact_name text,
  p_contact_email text,
  p_timezone text,
  p_notes text
)
returns public.partners
language plpgsql security invoker set search_path = public
as $$
declare v_row public.partners;
begin
  update public.partners
  set name = btrim(p_name), partner_type = p_partner_type, country = upper(btrim(p_country)),
      contact_name = nullif(btrim(p_contact_name), ''), contact_email = nullif(lower(btrim(p_contact_email)), ''),
      timezone = btrim(p_timezone), notes = nullif(btrim(p_notes), '')
  where id = p_partner_id and tenant_id = p_tenant_id and status <> 'offboarded'
  returning * into v_row;
  if not found then raise exception 'partner_not_found_or_offboarded'; end if;
  return v_row;
end;
$$;

create or replace function public.add_partner_term(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_payout_model public.partner_payout_model,
  p_rate_cents bigint,
  p_rate_pct_bp integer,
  p_effective_from date,
  p_created_by uuid
)
returns public.partner_terms
language plpgsql security invoker set search_path = public
as $$
declare v_row public.partner_terms;
begin
  perform 1 from public.partners where id = p_partner_id and tenant_id = p_tenant_id and status <> 'offboarded' for update;
  if not found then raise exception 'partner_not_found_or_offboarded'; end if;
  insert into public.partner_terms (partner_id, payout_model, rate_cents, rate_pct_bp, effective_from, created_by)
  values (p_partner_id, p_payout_model, p_rate_cents, p_rate_pct_bp, p_effective_from, p_created_by)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.transition_partner(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_next_status public.partner_status,
  p_confirmation text default null
)
returns public.partners
language plpgsql security invoker set search_path = public
as $$
declare
  v_row public.partners;
begin
  select * into v_row from public.partners where id = p_partner_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'partner_not_found'; end if;
  if v_row.status = 'offboarded' then raise exception 'partner_already_offboarded'; end if;
  if p_next_status = 'offboarded' and coalesce(p_confirmation, '') <> 'OFFBOARD' then raise exception 'offboard_confirmation_required'; end if;
  if not ((v_row.status = 'draft' and p_next_status = 'active') or
          (v_row.status = 'active' and p_next_status in ('paused', 'offboarded')) or
          (v_row.status = 'paused' and p_next_status in ('active', 'offboarded'))) then
    raise exception 'invalid_partner_transition:%:%', v_row.status, p_next_status;
  end if;

  update public.partners
  set status = p_next_status,
      paused_at = case when p_next_status = 'paused' then coalesce(paused_at, now()) else paused_at end,
      offboarded_at = case when p_next_status = 'offboarded' then now() else offboarded_at end
  where id = p_partner_id and tenant_id = p_tenant_id
  returning * into v_row;

  if p_next_status = 'offboarded' then
    update public.partner_users set status = 'revoked', revoked_at = coalesce(revoked_at, now())
    where partner_id = p_partner_id and status = 'active';
  end if;
  return v_row;
end;
$$;

alter table public.partners enable row level security;
alter table public.partner_terms enable row level security;
alter table public.partner_users enable row level security;

revoke all on public.partners, public.partner_terms, public.partner_users from anon, authenticated, public, tenant_app;
grant select on public.partners, public.partner_terms, public.partner_users to tenant_app;
grant select, insert, update on public.partners, public.partner_terms, public.partner_users to service_role;

create policy partners_tenant_read on public.partners for select to tenant_app
using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy partner_terms_tenant_read on public.partner_terms for select to tenant_app
using (exists (select 1 from public.partners p where p.id = partner_id and p.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid));
create policy partner_users_tenant_read on public.partner_users for select to tenant_app
using (exists (select 1 from public.partners p where p.id = partner_id and p.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid));

revoke all on function public.create_partner(uuid, text, public.partner_type, text, text, text, text, text, uuid, integer) from public;
revoke all on function public.update_partner(uuid, uuid, text, public.partner_type, text, text, text, text, text) from public;
revoke all on function public.add_partner_term(uuid, uuid, public.partner_payout_model, bigint, integer, date, uuid) from public;
revoke all on function public.transition_partner(uuid, uuid, public.partner_status, text) from public;
grant execute on function public.create_partner(uuid, text, public.partner_type, text, text, text, text, text, uuid, integer) to service_role;
grant execute on function public.update_partner(uuid, uuid, text, public.partner_type, text, text, text, text, text) to service_role;
grant execute on function public.add_partner_term(uuid, uuid, public.partner_payout_model, bigint, integer, date, uuid) to service_role;
grant execute on function public.transition_partner(uuid, uuid, public.partner_status, text) to service_role;
