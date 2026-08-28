// SA-2.5: proves usage_totals is a derived cache, not the source of truth — and is the fix when
// it drifts. Recomputes every total from the usage_events log.
//
// Run with: npm run rebuild:usage
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

// Snapshot the current cache so the rebuild can report what actually moved — a silent
// "rebuilt successfully" would hide the very drift this script exists to find.
const { data: before, error: beforeError } = await supabase
  .from("usage_totals")
  .select("tenant_id, meter_key, period_start, used_qty");

if (beforeError) {
  console.error("Could not read usage_totals:", beforeError.message);
  process.exit(1);
}

const keyOf = (r) => `${r.tenant_id}|${r.meter_key}|${r.period_start}`;
const beforeMap = new Map((before ?? []).map((r) => [keyOf(r), r.used_qty]));

const { data: rowCount, error } = await supabase.rpc("rebuild_usage_totals");
if (error) {
  console.error("Rebuild failed:", error.message);
  process.exit(1);
}

const { data: after } = await supabase
  .from("usage_totals")
  .select("tenant_id, meter_key, period_start, used_qty");

const afterMap = new Map((after ?? []).map((r) => [keyOf(r), r.used_qty]));

const drifted = [];
for (const [key, used] of afterMap) {
  const previous = beforeMap.get(key);
  if (previous !== used) drifted.push({ key, from: previous ?? "(missing)", to: used });
}
for (const [key, used] of beforeMap) {
  if (!afterMap.has(key)) drifted.push({ key, from: used, to: "(removed — no events)" });
}

console.log(`Rebuilt ${rowCount} total row(s) from the usage_events log.`);

if (drifted.length === 0) {
  console.log("No drift: the cache already matched the event log.");
} else {
  console.log(`\n${drifted.length} row(s) DIFFERED from the cache — the cache was wrong:`);
  for (const d of drifted) console.log(`  ${d.key}\n    ${d.from} -> ${d.to}`);
  console.log("\nWorth investigating why: a drifting aggregate usually means a write path bypassed record_usage().");
}
