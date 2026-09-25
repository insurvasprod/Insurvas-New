-- The last two ON CONFLICT targets with no unique index behind them.
--
-- `insert ... on conflict (a, b)` resolves against a unique index on exactly (a, b). Where the index
-- is absent the statement does not degrade, it raises
--
--   42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- and takes the whole request with it. scripts/check-conflict-targets.mjs now checks all 506
-- functions by column set rather than by index name, which is what ON CONFLICT actually matches on;
-- these two are what it found once its own array-parsing bug was fixed.
--
--   tenant_templates(tenant_id, product_code)   admin_apply_tenant_template
--     LA-1.4: the agent never receives a tenant-owned form copy, so the suite cannot get past
--     "agent receives a tenant-owned form copy" and aborts with "No tenant template copy".
--
--   lead_sla_events(work_item_id, rung)         run_unclaimed_sla
--     LA-1.23: the SLA ladder's idempotency is built on this. Its first acceptance criterion is
--     "each rung fires exactly once per lead, proven by running the job twice", and without the
--     index the upsert that enforces that cannot execute at all.
--
-- Checked before writing: zero duplicate (tenant_id, product_code) in tenant_templates, zero
-- duplicate (work_item_id, rung) in lead_sla_events. Both create cleanly.
--
-- The sibling tables admin_apply_tenant_template also upserts into -- tenant_template_fields,
-- _stages, _forms and _revisions -- already have their keys. Only the parent was missing.

create unique index if not exists tenant_templates_tenant_product_idx
  on public.tenant_templates (tenant_id, product_code);

create unique index if not exists lead_sla_events_work_item_rung_idx
  on public.lead_sla_events (work_item_id, rung);
