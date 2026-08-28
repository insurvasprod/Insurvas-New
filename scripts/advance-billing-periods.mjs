// SA-2.7: rolls every billing period that has ended, applying whatever was queued for it —
// downgrades take effect, cancellations complete, and meter allowances reset (usage is keyed by
// period_start, so a new period is simply a new bucket; nothing is deleted).
//
// Run with: npm run advance:periods
//
// This is what SA-6.1 should schedule. Until then it is manual, which means a queued downgrade
// only applies when someone runs this — see docs/backlog.md.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: due } = await supabase
  .from("subscriptions")
  .select("id, tenant_id, current_period_end, cancel_at_period_end, pending_plan_id")
  .neq("status", "cancelled")
  .lte("current_period_end", new Date().toISOString());

if (!due?.length) {
  console.log("Nothing due — every live subscription's period is still running.");
  process.exit(0);
}

console.log(`${due.length} subscription(s) with a period that has ended.\n`);

const { data: results, error } = await supabase.rpc("advance_billing_periods");

if (error) {
  console.error("Failed to advance periods:", error.message);
  process.exit(1);
}

const byAction = new Map();
for (const row of results ?? []) {
  byAction.set(row.action, (byAction.get(row.action) ?? 0) + 1);
  console.log(
    `  ${row.subscription_id}  ${row.action.padEnd(14)} ` +
      (row.action === "cancelled"
        ? ""
        : `-> ${new Date(row.new_period_start).toLocaleDateString()} – ${new Date(row.new_period_end).toLocaleDateString()}`),
  );
}

console.log("");
for (const [action, count] of byAction) console.log(`${action}: ${count}`);

// SA-2.8 note: each rolled subscription needs its entitlement rebuilt, since a queued plan
// change has now taken effect. Wire that in when the engine exists.
if ((byAction.get("plan_changed") ?? 0) > 0) {
  console.log("\nNote: plan changes applied — those tenants' entitlements need rebuilding (SA-2.8).");
}
