-- Demo QA authentication compatibility.
--
-- The connected project contains the older organization-based partner model and does not yet
-- contain the admin_users table from the repository baseline. This migration is additive: it
-- preserves existing identities and partner rows while adding the tenant-facing columns consumed
-- by the current application.

do $$ begin
  create type public.admin_role as enum ('super_admin', 'support_agent', 'billing_admin', 'platform_config');
exception when duplicate_object then null; end $$;

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  name text not null,
  role public.admin_role not null,
  is_active boolean not null default true,
  totp_secret text not null default '',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  constraint admin_users_email_key unique (email)
);

alter table public.admin_users add column if not exists email text;
alter table public.admin_users add column if not exists password_hash text;
alter table public.admin_users add column if not exists name text;
alter table public.admin_users add column if not exists role public.admin_role;
alter table public.admin_users add column if not exists is_active boolean not null default true;
alter table public.admin_users add column if not exists totp_secret text not null default '';
alter table public.admin_users add column if not exists last_login_at timestamptz;
alter table public.admin_users add column if not exists created_at timestamptz not null default now();

create unique index if not exists admin_users_email_lower_key on public.admin_users(lower(email));
alter table public.admin_users enable row level security;
revoke all on public.admin_users from public, anon, authenticated, tenant_app;
grant select, insert, update, delete on public.admin_users to service_role;

do $$ begin
  create type public.partner_user_role as enum ('partner_admin', 'partner_user');
exception when duplicate_object then null; end $$;

alter table public.partners add column if not exists tenant_id uuid;
alter table public.partners add column if not exists timezone text not null default 'UTC';

update public.partners p
   set tenant_id = t.id
  from public.tenants t
 where t.source_organization_id = p.organization_id
   and p.tenant_id is null;

alter table public.partners alter column tenant_id set not null;

do $$ begin
  alter table public.partners add constraint partners_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade;
exception when duplicate_object then null; end $$;

alter table public.partner_users add column if not exists tenant_id uuid;
alter table public.partner_users add column if not exists role public.partner_user_role;
alter table public.partner_users add column if not exists accepted_at timestamptz;
alter table public.partner_users add column if not exists deactivated_at timestamptz;

update public.partner_users pu
   set tenant_id = p.tenant_id
  from public.partners p
 where p.id = pu.partner_id
   and pu.tenant_id is null;

update public.partner_users
   set role = case when access_role = 'partner_admin' then 'partner_admin'::public.partner_user_role else 'partner_user'::public.partner_user_role end
 where role is null;

update public.partner_users
   set accepted_at = coalesce(accepted_at, created_at)
 where status = 'active'
   and accepted_at is null;

alter table public.partner_users alter column tenant_id set not null;
alter table public.partner_users alter column role set not null;

do $$ begin
  alter table public.partner_users add constraint partner_users_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete restrict;
exception when duplicate_object then null; end $$;

create index if not exists partners_tenant_status_idx on public.partners(tenant_id, status, created_at desc);
create index if not exists partner_users_tenant_partner_status_idx on public.partner_users(tenant_id, partner_id, status);
create index if not exists partner_users_user_status_idx on public.partner_users(user_id, status);

alter table public.partners enable row level security;
alter table public.partner_users enable row level security;
revoke all on public.partners, public.partner_users from public, anon, authenticated, tenant_app;
grant select, insert, update on public.partners, public.partner_users to service_role;
