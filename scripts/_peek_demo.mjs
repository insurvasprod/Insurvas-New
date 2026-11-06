import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const log = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const row of log.rows) {
  const cols = { agent_leads: "id, created_at, first_dial_at, lead_state, values", tenant_application_cases: "id, status, opened_at, closed_at", tenant_quotes: "id, status, application_id, created_at", tenant_applications: "id, status, outcome, submitted_at, updated_at, closed_at", deal_flow: "id, worked_by, monthly_premium_cents, created_at", tenant_issued_policies: "id, policy_number, issued_at, status" }[row.table];
  const { data } = await db.from(row.table).select(cols).eq("id", row.id).single();
  console.log(row.table, JSON.stringify(data).slice(0, 300));
}
