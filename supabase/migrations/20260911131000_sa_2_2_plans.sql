-- SA-2.2 · Plan CRUD + plan type
--
-- Creates `public.plans`, the `plan_type` enum, and the `admin_plan_list` view that
-- lib/plans/queries.ts reads. `/api/admin/plans` and `/admin/plans` currently return 500 because
-- none of these exist.
--
-- There is deliberately **no `plan_versions` table**. Versioning lives on `plans` itself as
-- (code, version) rows: `fetchPlanVersions()` selects every row sharing a code, and
-- `admin_plan_list` collapses them to the latest one per code. An earlier backlog draft listed
-- `plan_versions` as a required object; it is not, and nothing in the codebase references it.
--
-- `public.subscriptions` is created here as well, because `admin_plan_list` cannot report
-- subscriber counts without it. Only the table is created — the assign/change/cancel operations
-- are SA-2.7 and are not in this migration. Its shape is taken verbatim from the declared type in
-- lib/supabase/database.types.ts, which is what the application compiles against.

-- --------------------------------------------------------------------------
-- Enums
-- --------------------------------------------------------------------------

do $$ begin
  create type public.plan_type as enum ('individual', 'agency_no_teams', 'agency_with_teams', 'management');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.billing_cycle as enum ('monthly', 'quarterly', 'yearly');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.subscription_status as enum
    ('trialing', 'active', 'past_due', 'suspended', 'paused', 'cancelling', 'cancelled');
exception when duplicate_object then null;
end $$;

-- --------------------------------------------------------------------------
-- plans
-- --------------------------------------------------------------------------

create table if not exists public.plans (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,
  version      integer not null default 1,
  name         text not null,
  plan_type    public.plan_type not null,
  description  text,
  is_public    boolean not null default false,
  is_default   boolean not null default false,
  is_archived  boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

comment on table public.plans is
  'SA-2.2 · One row per plan VERSION. A plan is identified by code; (code, version) is unique. '
  'Editing a published plan creates a new version rather than mutating the old one, so a '
  'subscriber keeps the terms they signed up on.';

do $$ begin
  alter table public.plans add constraint plans_code_version_key unique (code, version);
exception when duplicate_table or duplicate_object then null;
end $$;

do $$ begin
  alter table public.plans add constraint plans_version_positive check (version >= 1);
exception when duplicate_object then null;
end $$;

-- A plan code is a stable identifier the pricing page and checkout refer to.
do $$ begin
  alter table public.plans add constraint plans_code_format check (code ~ '^[a-z][a-z0-9_]*$');
exception when duplicate_object then null;
end $$;

-- "The plan the public pricing page leads with. At most one, enforced by a partial index."
-- Every row reaching this index has is_default = true, so uniqueness on the column permits
-- exactly one such row across the whole table.
create unique index if not exists plans_single_default_idx on public.plans (is_default) where is_default;

create index if not exists plans_code_version_idx on public.plans (code, version desc);
create index if not exists plans_sort_idx on public.plans (sort_order) where not is_archived;

-- --------------------------------------------------------------------------
-- subscriptions — table only; SA-2.7 adds the operations
-- --------------------------------------------------------------------------

create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null,
  plan_id                uuid not null,
  pending_plan_id        uuid,
  status                 public.subscription_status not null default 'trialing',
  billing_cycle          public.billing_cycle not null default 'monthly',
  started_at             timestamptz not null default now(),
  current_period_start   timestamptz not null default now(),
  current_period_end     timestamptz,
  trial_ends_at          timestamptz,
  cancel_at_period_end   boolean not null default false,
  cancel_reason          text,
  cancelled_at           timestamptz,
  whop_membership_id     text,
  last_provider_event_at timestamptz,
  created_at             timestamptz not null default now()
);

comment on table public.subscriptions is
  'SA-2.7 · One tenant''s current subscription to one plan version. Created here because '
  'admin_plan_list cannot count subscribers without it; the assign/change/cancel operations are '
  'SA-2.7 and are not yet implemented.';

do $$ begin
  alter table public.subscriptions
    add constraint subscriptions_tenant_id_fkey foreign key (tenant_id)
    references public.tenants (id) on delete cascade;
exception when duplicate_object or undefined_table then null;
end $$;

do $$ begin
  alter table public.subscriptions
    add constraint subscriptions_plan_id_fkey foreign key (plan_id) references public.plans (id);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.subscriptions
    add constraint subscriptions_pending_plan_id_fkey foreign key (pending_plan_id)
    references public.plans (id);
exception when duplicate_object then null;
end $$;

-- One live subscription per tenant. A cancelled one may sit alongside its replacement.
create unique index if not exists subscriptions_one_live_per_tenant_idx
  on public.subscriptions (tenant_id) where status <> 'cancelled';

create index if not exists subscriptions_plan_idx on public.subscriptions (plan_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);

-- --------------------------------------------------------------------------
-- admin_plan_list — one row per plan code, its latest version, with counts
-- --------------------------------------------------------------------------

create or replace view public.admin_plan_list as
with latest as (
  select distinct on (p.code) p.*
    from public.plans p
   order by p.code, p.version desc
),
version_counts as (
  select code, count(*)::int as version_count
    from public.plans
   group by code
),
subscriber_counts as (
  select p.code,
         -- Live subscribers: anything not cancelled, matching fetchPlanVersions().
         count(s.id) filter (where s.status <> 'cancelled')::int as subscriber_count,
         -- Everyone who was ever on any version of this code, cancellations included. This is
         -- what makes "archived but still in use" visible before someone tries to delete it.
         count(s.id)::int as ever_subscribed_count
    from public.plans p
    left join public.subscriptions s on s.plan_id = p.id
   group by p.code
)
select l.id,
       l.code,
       l.version,
       l.name,
       l.plan_type,
       l.description,
       l.is_public,
       l.is_default,
       l.is_archived,
       l.sort_order,
       l.created_at,
       v.version_count,
       coalesce(c.subscriber_count, 0) as subscriber_count,
       coalesce(c.ever_subscribed_count, 0) as ever_subscribed_count
  from latest l
  join version_counts v on v.code = l.code
  left join subscriber_counts c on c.code = l.code;

comment on view public.admin_plan_list is
  'SA-2.2 · One row per plan code (its latest version) with version and subscriber counts. '
  'Read by lib/plans/queries.ts fetchPlans().';

-- --------------------------------------------------------------------------
-- Access
-- --------------------------------------------------------------------------

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists plans_service_role_only on public.plans;
create policy plans_service_role_only on public.plans
  for all to service_role using (true) with check (true);

drop policy if exists subscriptions_service_role_only on public.subscriptions;
create policy subscriptions_service_role_only on public.subscriptions
  for all to service_role using (true) with check (true);

revoke all on public.plans from public, anon, authenticated, tenant_app;
revoke all on public.subscriptions from public, anon, authenticated, tenant_app;
revoke all on public.admin_plan_list from public, anon, authenticated, tenant_app;
grant select, insert, update, delete on public.plans to service_role;
grant select, insert, update, delete on public.subscriptions to service_role;
grant select on public.admin_plan_list to service_role;
