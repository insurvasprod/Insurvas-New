-- ============================================================================
-- Purge verify-script test tenants from PRODUCTION — 2026-09-30
-- Run by hand in the Supabase SQL editor. PERMANENT. Read every step first.
-- ============================================================================
-- Measured 2026-09-30 (read-only):
--   615 tenants; 605 are test leftovers (name ends in a 13-digit ms timestamp,
--   e.g. "LA-1.13 A 1789460597394", or is QA-named, e.g. "QA Load Test Workspace").
--   They hold 350,301 of the 366,296 leads (96%), 320,297 of 336,287 queue rows,
--   100,003 of 116,449 activity rows, plus ~176 seeded disposition rows each.
--   375 of them can be deleted outright. 230 cannot: they hold payments, credit
--   notes, platform invoices, partner users or partner rejections, which are
--   RESTRICT on purpose (financial records). For those, only their LEADS are removed.
--
-- KEPT, never touched (the predicate below excludes them; check Step 0 shows them):
--   LA-1.25 Alert Demo (d6f3950f…, the QA demo agency), Insurvas, Permanent Basic LA
--   Demo, INSURVAS Local Rebuild Tenant A/B, Isolation Test A/B, Pike & Lowell
--   Insurance, Quinn Agtest's Workspace, and the second empty "LA-1.25 Alert Demo".
--
-- The test predicate, used identically in every step:
--   (name ~ '\m1[0-9]{12}\M' or name ~* '^(qa|test|e2e)[\s·_-]' or name ~* '\m(qa|probe|fixture|smoke)\M')
--   and id <> 'd6f3950f-0d88-4e66-869f-0de2ea6b396b'
--
-- Run each step as its own query. Steps 2–4 are repeated until they report 0 rows.
-- If a step hits a statement timeout, lower its LIMIT (e.g. 20000 → 5000) and rerun.
-- ============================================================================


-- ── STEP 0 · preview (read-only). Confirm the KEPT list and the counts. ─────────
select name, status, created_at::date from public.tenants t
where not ((t.name ~ '\m1[0-9]{12}\M' or t.name ~* '^(qa|test|e2e)[\s·_-]' or t.name ~* '\m(qa|probe|fixture|smoke)\M')
           and t.id <> 'd6f3950f-0d88-4e66-869f-0de2ea6b396b')
order by name;                                   -- expect exactly the 10 KEPT tenants

select count(*) as test_tenants,
       (select count(*) from public.agent_leads l join public.tenants t on t.id = l.tenant_id
         where (t.name ~ '\m1[0-9]{12}\M' or t.name ~* '^(qa|test|e2e)[\s·_-]' or t.name ~* '\m(qa|probe|fixture|smoke)\M')
           and t.id <> 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as test_leads
from public.tenants t
where (t.name ~ '\m1[0-9]{12}\M' or t.name ~* '^(qa|test|e2e)[\s·_-]' or t.name ~* '\m(qa|probe|fixture|smoke)\M')
  and t.id <> 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';   -- expect 605 and ~350,301


-- ── STEP 1 · pause the every-minute jobs while purging (they fight for the same CPU) ──
-- (cron.job itself is read-only to the SQL editor; pg_cron's own function changes it.)
select cron.alter_job(jobid, active := false)
from cron.job
where jobname in ('callback-due', 'callback-in-app-reminders', 'unclaimed-sla-ladder', 'unclaimed-sla-side-effects', 'partner-intake-reconciliation');


-- ── STEP 2 · delete test LEADS in batches. REPEAT until it says "DELETE 0" (~18 runs). ──
-- Cascades to their queue rows, activity, SLA events, call attempts, consent artefacts…
delete from public.agent_leads
where id in (
  select l.id from public.agent_leads l join public.tenants t on t.id = l.tenant_id
  where (t.name ~ '\m1[0-9]{12}\M' or t.name ~* '^(qa|test|e2e)[\s·_-]' or t.name ~* '\m(qa|probe|fixture|smoke)\M')
    and t.id <> 'd6f3950f-0d88-4e66-869f-0de2ea6b396b'
  limit 20000);


-- ── STEP 3 · leftover test QUEUE rows (lead link already null). REPEAT until "DELETE 0". ──
delete from public.lead_queue
where id in (
  select q.id from public.lead_queue q join public.tenants t on t.id = q.tenant_id
  where (t.name ~ '\m1[0-9]{12}\M' or t.name ~* '^(qa|test|e2e)[\s·_-]' or t.name ~* '\m(qa|probe|fixture|smoke)\M')
    and t.id <> 'd6f3950f-0d88-4e66-869f-0de2ea6b396b'
  limit 20000);


-- ── STEP 4 · delete the test TENANTS that hold no financial/partner records. ──────
-- REPEAT until "DELETE 0" (~8 runs of 50). Their pipelines, stages, disposition flows,
-- users' memberships, settings etc. cascade. The 230 with payments/invoices/credit
-- notes/partner rows are skipped by the NOT EXISTS checks and stay (without leads).
delete from public.tenants
where id in (
  select t.id from public.tenants t
  where (t.name ~ '\m1[0-9]{12}\M' or t.name ~* '^(qa|test|e2e)[\s·_-]' or t.name ~* '\m(qa|probe|fixture|smoke)\M')
    and t.id <> 'd6f3950f-0d88-4e66-869f-0de2ea6b396b'
    and not exists (select 1 from public.payments x where x.tenant_id = t.id)
    and not exists (select 1 from public.credit_notes x where x.tenant_id = t.id)
    and not exists (select 1 from public.platform_invoices x where x.tenant_id = t.id)
    and not exists (select 1 from public.partner_users x where x.tenant_id = t.id)
    and not exists (select 1 from public.partner_rejected_submissions x where x.tenant_id = t.id)
  limit 50);


-- ── STEP 5 · resume the jobs ───────────────────────────────────────────────────
select cron.alter_job(jobid, active := true)
from cron.job
where jobname in ('callback-due', 'callback-in-app-reminders', 'unclaimed-sla-ladder', 'unclaimed-sla-side-effects', 'partner-intake-reconciliation');


-- ── STEP 6 · give the space back (quiet time; each line on its own; locks the table) ──
vacuum full analyze public.agent_leads;
vacuum full analyze public.lead_queue;
vacuum full analyze public.tenant_lead_activity;
vacuum full analyze public.disposition_options;
vacuum full analyze public.disposition_nodes;
vacuum full analyze public.tenant_disposition_flows;
vacuum full analyze public.tenant_pipeline_stages;
vacuum full analyze public.tenant_pipelines;


-- ── STEP 7 · check ──────────────────────────────────────────────────────────────
select pg_size_pretty(pg_database_size(current_database())) as database_size;   -- was 1135 MB
select count(*) as tenants, (select count(*) from public.agent_leads) as leads from public.tenants;
