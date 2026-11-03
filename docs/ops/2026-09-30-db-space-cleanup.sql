-- ============================================================================
-- Database space cleanup — 2026-09-30   (run by hand in the Supabase SQL editor)
-- ============================================================================
-- WHY: the project is on NANO (≈0.5 GB RAM) and 1.12 GB of data, so it swaps, and
-- on 2026-09-30 the API went down (PGRST002) for about an hour. A large share of
-- that 1.12 GB is space left behind by test runs, not data:
--
--   table                      live rows   size     inserted / deleted since 25 Aug
--   disposition_options          108,298   235 MB   1,275,466 / 1,398,484
--   disposition_nodes             13,539    30 MB     159,443 /   290,556
--   tenant_disposition_flows      13,537    28 MB     159,444 /   292,778
--   tenant_pipeline_stages        13,537    29 MB     162,435 /   296,436
--   tenant_pipelines               1,846     —         22,205 /    40,764
--
-- Cause: 54 of the 77 scripts/verify-*.mjs create a tenant against this (production)
-- database each run. Every new tenant is seeded by trigger with 3 pipelines, ~22 stages,
-- one disposition flow per stage and ~8 options per flow (~176 option rows per tenant).
-- Scripts that delete their tenant leave dead space; scripts that only suspend it
-- (billing: coupons, credit notes, invoices, period billing) leave the whole tenant.
-- 615 tenants exist today; nearly all are these leftovers (names like
-- "Credit note 1789144927616", 358 of them suspended, 284 created on 13 Sep alone).
--
-- NOTHING BELOW DELETES DATA. Step 3 only lists; deleting tenants is your decision.
-- ============================================================================


-- ── STEP 1 · safe any time: make the dead space reusable (no lock on reads/writes) ──
-- Run each line on its own (VACUUM cannot run inside a multi-statement batch).
vacuum (analyze) public.disposition_options;
vacuum (analyze) public.disposition_nodes;
vacuum (analyze) public.tenant_disposition_flows;
vacuum (analyze) public.tenant_pipeline_stages;
vacuum (analyze) public.tenant_pipelines;
vacuum (analyze) public.agent_leads;
vacuum (analyze) public.lead_queue;


-- ── STEP 2 · QUIET HOURS ONLY: give the space back (≈200+ MB) ──────────────────────
-- VACUUM FULL rewrites the table and LOCKS it (no reads, no writes) while it runs.
-- On nano expect seconds to a couple of minutes each; the dialer and disposition
-- screens will wait during that time. Run one line at a time, smallest first.
vacuum full analyze public.tenant_pipelines;
vacuum full analyze public.tenant_pipeline_stages;
vacuum full analyze public.tenant_disposition_flows;
vacuum full analyze public.disposition_nodes;
vacuum full analyze public.disposition_options;      -- the big one: 235 MB → roughly 30 MB

-- Check the result:
select relname, pg_size_pretty(pg_total_relation_size(relid)) as size, n_live_tup, n_dead_tup
from pg_stat_user_tables
where relname in ('disposition_options','disposition_nodes','tenant_disposition_flows','tenant_pipeline_stages','tenant_pipelines')
order by pg_total_relation_size(relid) desc;


-- ── STEP 3 · REVIEW ONLY: which tenants look like test leftovers ───────────────────
-- A name ending in a 13-digit millisecond timestamp is the verify-script pattern.
-- Read this list; keep anything real (Insurvas, the demo agency, any customer).
select t.id, t.name, t.status, t.created_at
from public.tenants t
where t.name ~ '\m1[0-9]{12}\M'                -- "Credit note 1789144927616"
   or t.name ~* '^(qa|test|e2e)[\s·_-]'
order by t.created_at;

-- Count only:
select count(*) filter (where name ~ '\m1[0-9]{12}\M') as timestamped_test_names,
       count(*) filter (where status = 'suspended')     as suspended,
       count(*)                                         as all_tenants
from public.tenants;

-- Deleting them is a separate, deliberate step (their invoices, audit rows and
-- entitlements are linked). Ask for a reviewed delete script once you have
-- confirmed the list; do not bulk-delete from this file.


-- ── STEP 4 · stop it coming back ────────────────────────────────────────────────────
-- Point scripts/verify-*.mjs at a separate dev project or a Supabase branch, not
-- production, and make every one of them delete what it created.
