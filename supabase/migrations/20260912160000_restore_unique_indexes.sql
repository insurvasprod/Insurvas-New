-- Restore the unique indexes the application depends on.
--
-- The 2026-09-11 reconciliation emitted `create index` only for tables it created, because an index
-- on a pre-existing table was treated as touching the organizations-era product's schema. Right
-- default for a performance index, wrong for a UNIQUE one: a unique index is not decoration, it is
-- what `insert ... on conflict (a, b)` resolves against, and it is what stops two rows existing
-- that the application assumes cannot both exist.
--
-- scripts/check-missing-indexes.mjs found 122 declared indexes missing on live tables, 15 of them
-- unique. This restores 13 of those 15, verbatim from the migrations that declared them so the
-- partial predicates match exactly.
--
-- Checked before writing: zero duplicate email groups, zero tenants with more than one live
-- subscription. The data has not diverged yet, so every one of these can be created now. That will
-- not stay true indefinitely, which is the argument for doing it today rather than later.
--
-- DELIBERATELY OMITTED, 2 of the 15:
--   pipelines_one_default_per_partner_idx
--   pipeline_stages_active_position_idx
-- Both target the quarantined tables. `pipelines` and `pipeline_stages` exist here as the
-- organizations-era product's tables with bigint keys and a different column set, so the columns
-- these indexes name (partner_type, is_default, position, is_archived) are not there to index. They
-- belong with LA-1.9, once the uuid/bigint collision is settled.

-- Identity -------------------------------------------------------------------
-- Without this, two accounts can hold the same address and every lookup by email is ambiguous.
create unique index if not exists users_email_lower_unique on public.users (lower(email));

-- One live invitation per person per purpose. Otherwise a resend leaves the previous token valid.
create unique index if not exists user_invitations_one_live_idx
  on public.user_invitations (user_id, purpose) where accepted_at is null;

-- Billing --------------------------------------------------------------------
-- A tenant billing against two live subscriptions charges twice and reports twice.
create unique index if not exists subscriptions_one_live_per_tenant
  on public.subscriptions using btree (tenant_id) where (status <> 'cancelled'::subscription_status);

create unique index if not exists subscription_addons_one_live
  on public.subscription_addons using btree (subscription_id, addon_id) where (detached_at is null);

-- The idempotency key only means anything if the database enforces it.
create unique index if not exists usage_events_idempotency
  on public.usage_events using btree (tenant_id, meter_key, idempotency_key);

create unique index if not exists payment_providers_single_default_per_tenant
  on public.payment_providers using btree (tenant_id) where is_default;

-- Intake ---------------------------------------------------------------------
-- The dedupe key LA-0.6 is built on. Without it, the same household can exist twice and the
-- duplicate scoring compares against a set that already contains duplicates.
create unique index if not exists households_tenant_address_hash_idx
  on public.households (tenant_id, address_hash) where address_hash is not null;

-- One active queue row per lead. Two means two agents can be served the same person.
create unique index if not exists lead_queue_active_lead_idx
  on public.lead_queue (lead_id) where status in ('unclaimed', 'claimed');

-- A partner resubmitting the same submission_id must not create a second lead.
create unique index if not exists agent_leads_partner_submission_idx
  on public.agent_leads (tenant_id, partner_id, submission_id)
  where partner_id is not null and submission_id is not null;

create unique index if not exists callbacks_active_work_item_idx
  on public.callbacks (tenant_id, work_item_id) where status in ('scheduled', 'due');

create unique index if not exists verification_sessions_active_work_item_idx
  on public.verification_sessions (work_item_id) where ended_at is null;

create unique index if not exists verification_sessions_active_idx
  on public.verification_sessions (work_item_id, user_id) where ended_at is null;

create unique index if not exists partner_channels_direct_key_idx
  on public.partner_channels (tenant_id, direct_key)
  where channel_type = 'direct' and direct_key is not null;

-- Partner products -----------------------------------------------------------
-- Not one of the 15, and the reason LA-1.3 loses eight acceptance criteria:
-- set_partner_product_approval upserts `on conflict (partner_id, product_code)` and the live table
-- has no such key. `partner_products` here is the organizations-era table, an effective-dated
-- agreement keyed UNIQUE (partner_id, name, effective_from); the reconciliation added the tenant
-- plane's columns to it but could not add a key. Partial on product_code so the other product's
-- rows, which leave it null, are unaffected.
create unique index if not exists partner_products_partner_product_code_idx
  on public.partner_products (partner_id, product_code) where product_code is not null;
