// LA-1.7 daily reconciliation job. A partner lead must have a queue item or a durable failure.
//
// `--tenant=<uuid>` checks one tenant through public.reconcile_partner_intake_for_tenant
// (20260929120000). The whole-database check walks every partner lead, answers near the statement
// timeout on the shared project, and PostgREST caps its answer at 1,000 rows, so it cannot vouch
// for one tenant. Exit codes: 0 clean, 1 orphans found or the check failed, 3 the per-tenant
// function is not applied yet.
import { createClient } from "@supabase/supabase-js";

const tenantArg = process.argv.slice(2).find((arg) => arg.startsWith("--tenant="));
const tenantId = tenantArg ? tenantArg.slice("--tenant=".length) : null;
if (tenantArg && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
  console.error("Intake reconciliation could not run: --tenant must be a tenant id (uuid).");
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const result = tenantId
  ? await db.rpc("reconcile_partner_intake_for_tenant", { p_tenant_id: tenantId })
  : await db.rpc("reconcile_partner_intake");
const rows = result.data ?? [];
const scope = tenantId ? ` in tenant ${tenantId}` : "";
if (result.error && tenantId && (result.error.code === "PGRST202" || result.error.code === "42883")) {
  console.error("Intake reconciliation could not run: schema pending: 20260929120000_reconcile_partner_intake_for_one_tenant.sql is not applied.");
  process.exitCode = 3;
} else if (result.error) {
  console.error(`Intake reconciliation could not run: ${result.error.message}`);
  process.exitCode = 1;
} else if (rows.length) {
  console.error(`Intake reconciliation found ${rows.length} partner lead(s)${scope} without a work item or logged failure.`);
  for (const row of rows) console.error(`  ${row.lead_id} tenant=${row.tenant_id} submission=${row.submission_id ?? "none"} missing=${(row.missing_steps ?? []).join(",")}`);
  process.exitCode = 1;
} else {
  console.log(`Intake reconciliation passed${scope}: every partner lead has a work item or durable failure record.`);
  process.exitCode = 0;
}
