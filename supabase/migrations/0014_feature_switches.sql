-- SA-4.10 · Global feature kill switches.
--
-- NOT the same thing as an entitlement, and the difference is the whole ticket:
--   entitlement  = "you did not pay for this"      -> upgrade prompt, per tenant, set by their plan
--   kill switch  = "this is off for everyone now"  -> gone, platform-wide, set by a super admin
--
-- Evaluation order is kill switch FIRST, then entitlement. A killed feature is invisible even to
-- a tenant whose plan grants it.
--
-- Deliberately NOT folded into tenant_entitlements. That table is a per-tenant cache refreshed by
-- refresh_tenant_entitlement(); putting switches in it would mean one toggle had to rebuild every
-- tenant's row, making a safety control depend on a bulk job finishing. This table is read
-- directly instead — one small platform-wide lookup shared by every request.

create table if not exists public.feature_switches (
  feature_key     text primary key references public.features (feature_key) on delete cascade,
  state           text        not null default 'on' check (state in ('on', 'off', 'beta')),
  beta_tenant_ids uuid[]      not null default '{}',
  off_message     text,
  updated_by      uuid        references public.admin_users (id) on delete set null,
  updated_at      timestamptz not null default now()
);

comment on table public.feature_switches is
  'SA-4.10 · Platform-wide feature kill switches. A feature with NO ROW here is on — the table '
  'holds exceptions only, so a fresh database is fully working and a missing row is never an error.';
comment on column public.feature_switches.beta_tenant_ids is
  'Only meaningful when state = ''beta'': the feature is on for exactly these tenants and off for '
  'everyone else.';
comment on column public.feature_switches.off_message is
  'Shown to an agent who reaches a killed feature directly. Null means show nothing at all.';

-- The only query pattern: fetch every row that is not plain "on". Tiny, but it keeps the read
-- index-only as the catalog grows.
create index if not exists feature_switches_not_on_idx
  on public.feature_switches (feature_key)
  where state <> 'on';

-- Control-plane data. RLS with no policy denies every role that does not bypass it; tenant_app is
-- NOBYPASSRLS by design (SA-0.2), so it gets nothing here even though the switches govern what
-- tenant-plane code may do. The tenant plane never reads this table — the server resolves the
-- effective feature list before any tenant-scoped query runs.
alter table public.feature_switches enable row level security;

revoke all on public.feature_switches from public;
revoke all on public.feature_switches from anon;
revoke all on public.feature_switches from authenticated;
revoke all on public.feature_switches from tenant_app;

-- No seed. Every feature starts on, which is what an empty table already means.
