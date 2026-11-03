-- Partner hierarchy form configuration. Shared field definitions remain tenant-owned;
-- these records only select and order those governed fields. A profile belongs to an admin or a
-- particular partner user, never to an arbitrary browser-selected publisher.
create table if not exists public.partner_submission_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete cascade,
  product_code text not null references public.products(code) on delete restrict,
  subject_user_id uuid references public.users(id) on delete cascade,
  scope text not null default 'publisher' check (scope in ('publisher', 'partner_admin', 'partner_user')),
  current_revision integer not null default 1 check (current_revision > 0),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, partner_id, product_code, subject_user_id, scope)
);

-- The initial publisher-level editor shipped a table with `revision`, `fields`, and
-- `verification_fields` directly on the profile. Upgrade it without discarding a
-- customer's saved configuration: old rows become `publisher` defaults, while new
-- admin/user rows use the revision journal below.
alter table public.partner_submission_profiles
  add column if not exists subject_user_id uuid references public.users(id) on delete cascade,
  add column if not exists scope text,
  add column if not exists current_revision integer;

alter table public.partner_submission_profiles
  alter column scope set default 'publisher';

update public.partner_submission_profiles
set scope = coalesce(scope, 'publisher'),
    current_revision = coalesce(current_revision, 1);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_submission_profiles' and column_name = 'revision') then
    execute 'update public.partner_submission_profiles set current_revision = coalesce(current_revision, revision, 1)';
  end if;
end;
$$;

alter table public.partner_submission_profiles
  alter column scope set not null,
  alter column current_revision set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.partner_submission_profiles'::regclass and conname = 'partner_submission_profiles_scope_check') then
    alter table public.partner_submission_profiles add constraint partner_submission_profiles_scope_check check (scope in ('publisher', 'partner_admin', 'partner_user'));
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.partner_submission_profiles'::regclass and conname = 'partner_submission_profiles_tenant_id_partner_id_product_co_key') then
    alter table public.partner_submission_profiles drop constraint partner_submission_profiles_tenant_id_partner_id_product_co_key;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.partner_submission_profiles'::regclass and conname = 'partner_submission_profiles_scope_identity_key') then
    alter table public.partner_submission_profiles add constraint partner_submission_profiles_scope_identity_key unique nulls not distinct (tenant_id, partner_id, product_code, subject_user_id, scope);
  end if;
end;
$$;

create index if not exists partner_submission_profiles_lookup_idx
  on public.partner_submission_profiles (tenant_id, partner_id, product_code, subject_user_id, scope);

create table if not exists public.partner_submission_profile_revisions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.partner_submission_profiles(id) on delete cascade,
  revision integer not null check (revision > 0),
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  verification_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(verification_fields) = 'array'),
  source_template_revision integer not null check (source_template_revision > 0),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (profile_id, revision)
);

create index if not exists partner_submission_profile_revisions_lookup_idx
  on public.partner_submission_profile_revisions (profile_id, revision desc);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_submission_profiles' and column_name = 'fields') then
    execute $sql$
      insert into public.partner_submission_profile_revisions (profile_id, revision, fields, verification_fields, source_template_revision, created_by, created_at)
      select id, current_revision, fields, verification_fields, 1, created_by, created_at
      from public.partner_submission_profiles
      where subject_user_id is null and scope = 'publisher'
      on conflict (profile_id, revision) do nothing
    $sql$;
  end if;
end;
$$;

alter table public.partner_submission_profiles enable row level security;
alter table public.partner_submission_profile_revisions enable row level security;
revoke all on public.partner_submission_profiles from public, anon, authenticated;
revoke all on public.partner_submission_profile_revisions from public, anon, authenticated;
grant select, insert, update, delete on public.partner_submission_profiles to service_role;
grant select, insert, update, delete on public.partner_submission_profile_revisions to service_role;

comment on table public.partner_submission_profiles is
  'Owner-managed admin or user form profile; fields are snapshots of tenant template keys and never define new lead fields.';
