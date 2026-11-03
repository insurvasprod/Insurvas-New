-- Reusable, tenant-owned partner form presets and inherited carrier/state access.
-- Every write is performed through owner APIs using the service role; no browser role
-- receives direct table or function access.

create table if not exists public.partner_form_presets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_code text not null references public.products(code) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 120),
  current_revision integer not null default 1 check (current_revision > 0),
  archived_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists partner_form_presets_active_name_idx
  on public.partner_form_presets (tenant_id, product_code, lower(name))
  where archived_at is null;

create table if not exists public.partner_form_preset_revisions (
  preset_id uuid not null references public.partner_form_presets(id) on delete restrict,
  revision integer not null check (revision > 0),
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  verification_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(verification_fields) = 'array'),
  source_template_revision integer not null check (source_template_revision > 0),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (preset_id, revision)
);

alter table public.partner_submission_profile_revisions
  add column if not exists source_preset_id uuid references public.partner_form_presets(id) on delete restrict,
  add column if not exists source_preset_revision integer;

create table if not exists public.partner_market_access_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete restrict,
  subject_user_id uuid references public.users(id) on delete restrict,
  scope text not null check (scope in ('publisher', 'partner_admin', 'partner_user')),
  current_revision integer not null default 1 check (current_revision > 0),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'publisher' and subject_user_id is null) or (scope <> 'publisher' and subject_user_id is not null))
);

create unique index if not exists partner_market_access_profiles_scope_idx
  on public.partner_market_access_profiles (tenant_id, partner_id, scope, coalesce(subject_user_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.partner_market_access_profile_revisions (
  profile_id uuid not null references public.partner_market_access_profiles(id) on delete restrict,
  revision integer not null check (revision > 0),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (profile_id, revision)
);

create table if not exists public.partner_market_access_revision_items (
  profile_id uuid not null,
  revision integer not null,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  state text not null check (state ~ '^[A-Z]{2}$'),
  primary key (profile_id, revision, carrier_id, state),
  foreign key (profile_id, revision) references public.partner_market_access_profile_revisions(profile_id, revision) on delete restrict
);

create index if not exists partner_market_access_revision_items_lookup_idx
  on public.partner_market_access_revision_items (carrier_id, state);

alter table public.form_drafts
  add column if not exists carrier_id uuid references public.carriers(id) on delete restrict,
  add column if not exists carrier_state text check (carrier_state is null or carrier_state ~ '^[A-Z]{2}$'),
  add column if not exists partner_market_access_profile_id uuid references public.partner_market_access_profiles(id) on delete restrict,
  add column if not exists partner_market_access_profile_revision integer;

alter table public.agent_leads
  add column if not exists carrier_id uuid references public.carriers(id) on delete restrict,
  add column if not exists carrier_state text check (carrier_state is null or carrier_state ~ '^[A-Z]{2}$'),
  add column if not exists partner_market_access_profile_id uuid references public.partner_market_access_profiles(id) on delete restrict,
  add column if not exists partner_market_access_profile_revision integer;

create index if not exists agent_leads_partner_market_access_idx
  on public.agent_leads (tenant_id, carrier_id, carrier_state, partner_market_access_profile_id, partner_market_access_profile_revision)
  where carrier_id is not null;

create or replace function public.save_partner_market_access_profile_revision(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_subject_user_id uuid,
  p_scope text,
  p_markets jsonb,
  p_created_by uuid
)
returns table(profile_id uuid, revision integer)
language plpgsql security definer set search_path = public
as $$
begin
  if p_scope not in ('publisher', 'partner_admin', 'partner_user') then raise exception 'invalid_market_profile_scope'; end if;
  if (p_scope = 'publisher' and p_subject_user_id is not null) or (p_scope <> 'publisher' and p_subject_user_id is null) then raise exception 'invalid_market_profile_subject'; end if;
  if jsonb_typeof(coalesce(p_markets, '[]'::jsonb)) <> 'array' then raise exception 'market_access_must_be_an_array'; end if;

  return query
  with profile as (
    insert into public.partner_market_access_profiles (tenant_id, partner_id, subject_user_id, scope, current_revision, created_by)
    values (p_tenant_id, p_partner_id, p_subject_user_id, p_scope, 1, p_created_by)
    on conflict (tenant_id, partner_id, scope, coalesce(subject_user_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set current_revision = public.partner_market_access_profiles.current_revision + 1, updated_at = now()
    returning id, current_revision
  ), revision_row as (
    insert into public.partner_market_access_profile_revisions (profile_id, revision, created_by)
    select profile.id, profile.current_revision, p_created_by from profile
    returning partner_market_access_profile_revisions.profile_id, partner_market_access_profile_revisions.revision
  ), items as (
    insert into public.partner_market_access_revision_items (profile_id, revision, carrier_id, state)
    select revision_row.profile_id, revision_row.revision, row.carrier_id, upper(row.state)
    from revision_row
    cross join jsonb_to_recordset(p_markets) as row(carrier_id uuid, state text)
    returning 1
  )
  select revision_row.profile_id, revision_row.revision from revision_row;
end;
$$;

alter table public.partner_form_presets enable row level security;
alter table public.partner_form_preset_revisions enable row level security;
alter table public.partner_market_access_profiles enable row level security;
alter table public.partner_market_access_profile_revisions enable row level security;
alter table public.partner_market_access_revision_items enable row level security;

revoke all on table public.partner_form_presets, public.partner_form_preset_revisions, public.partner_market_access_profiles, public.partner_market_access_profile_revisions, public.partner_market_access_revision_items from public, anon, authenticated, tenant_app;
revoke all on function public.save_partner_market_access_profile_revision(uuid, uuid, uuid, text, jsonb, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.save_partner_market_access_profile_revision(uuid, uuid, uuid, text, jsonb, uuid) to service_role;
