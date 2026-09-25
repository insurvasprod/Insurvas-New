// LA-1.7 daily reconciliation job. A partner lead must have a queue item or a durable failure.
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const result = await db.rpc("reconcile_partner_intake");
if (result.error) {
  console.error(`Intake reconciliation could not run: ${result.error.message}`);
  process.exitCode = 1;
} else if ((result.data ?? []).length) {
  console.error(`Intake reconciliation found ${(result.data ?? []).length} partner lead(s) without a work item or logged failure.`);
  for (const row of result.data ?? []) console.error(`  ${row.lead_id} tenant=${row.tenant_id} submission=${row.submission_id ?? "none"} missing=${(row.missing_steps ?? []).join(",")}`);
  process.exitCode = 1;
} else {
  console.log("Intake reconciliation passed: every partner lead has a work item or durable failure record.");
  process.exitCode = 0;
}
