-- Performance · index the foreign keys the database has been seq-scanning to enforce.
--
-- Measured against the live project on 2026-09-23 (pg_stat_user_tables, stats since 2026-08-25):
--
--   table                      rows     seq_scan    rows read by seq scans
--   tenant_lead_sla_events     31,460    820,772    10,510,954,356
--   tenant_disposition_flows   12,920    173,411     4,721,808,181
--
-- Neither table is large. The reads come from foreign keys whose REFERENCING column has no index:
-- Postgres indexes the parent side of a foreign key automatically, never the child side. So every
-- delete of a parent row — and every `on delete cascade` fanning out from one — has to scan the whole
-- child table to find the rows pointing at it. One deleted lead is one full scan of the SLA events;
-- a 20,000-row import rolled back is 20,000 of them. That is the ten billion rows, and it is work the
-- database does inside the transaction that deleted the lead, so it lands on whoever pressed the
-- button.
--
-- Found with the unindexed-foreign-key query (a constraint's column list not being a leading prefix
-- of any index on the child). `pg_stat_statements` is not installed, so this is inferred from the
-- catalogue and the scan counters rather than from a captured slow query — but the child tables have
-- no application reader that filters by these columns, which leaves the foreign-key checks as the
-- only thing that can be scanning them this often.
--
-- tenant_disposition_flows already has (tenant_id, stage_id) twice — as a unique constraint and as
-- a plain index — but a foreign key on stage_id alone cannot use an index that leads with tenant_id.
--
-- `if not exists` throughout, so re-running is a no-op. Not CONCURRENTLY: a migration runs in a
-- transaction, and the two hot tables are small enough (≈31k and ≈13k rows) that the build takes well
-- under a second. The two lead_queue indexes are partial (`where … is not null`), so they cover only
-- rows that have been claimed or owned and stay a fraction of the table's 214k rows.

-- ── tenant_lead_sla_events ─────────────────────────────────────────────────────────────────────
-- lead_id → agent_leads (on delete cascade), tenant_id → tenants (on delete cascade),
-- partner_id → partners (on delete set null).
create index if not exists tenant_lead_sla_events_lead_idx
  on public.tenant_lead_sla_events (lead_id);
create index if not exists tenant_lead_sla_events_tenant_idx
  on public.tenant_lead_sla_events (tenant_id, occurred_at desc);
create index if not exists tenant_lead_sla_events_partner_idx
  on public.tenant_lead_sla_events (partner_id)
  where partner_id is not null;

-- The SLA runner's 24-hour digest (lib/queueSla/service.ts) filters on occurred_at and rung. It runs
-- on every scheduler tick and currently scans the table to do it.
create index if not exists tenant_lead_sla_events_recent_rung_idx
  on public.tenant_lead_sla_events (occurred_at desc)
  where rung in ('escalate', 'expire');

-- ── tenant_disposition_flows ───────────────────────────────────────────────────────────────────
-- stage_id → tenant_pipeline_stages, root_node_id → disposition_nodes.
create index if not exists tenant_disposition_flows_stage_idx
  on public.tenant_disposition_flows (stage_id);
create index if not exists tenant_disposition_flows_root_node_idx
  on public.tenant_disposition_flows (root_node_id)
  where root_node_id is not null;

-- ── lead_queue ─────────────────────────────────────────────────────────────────────────────────
-- claimed_by / owner_user_id → users. Deactivating or removing a user checks every queue row, and
-- the transfer inbox filters by claimant.
create index if not exists lead_queue_claimed_by_idx
  on public.lead_queue (claimed_by)
  where claimed_by is not null;
create index if not exists lead_queue_owner_user_idx
  on public.lead_queue (owner_user_id)
  where owner_user_id is not null;

-- ── announcement_dismissals ────────────────────────────────────────────────────────────────────
-- Read by user_id on every full load of the agent shell; the primary key leads with
-- announcement_id, so it cannot serve that read.
create index if not exists announcement_dismissals_user_idx
  on public.announcement_dismissals (user_id);
