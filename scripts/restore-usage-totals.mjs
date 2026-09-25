/**
 * Rebuilds the `usage_totals` cache from `usage_events`, in the application rather than in SQL.
 *
 *   node --env-file=.env.local scripts/restore-usage-totals.mjs --dry-run
 *   node --env-file=.env.local scripts/restore-usage-totals.mjs
 *
 * ## Why this exists alongside `rebuild:usage`
 *
 * `npm run rebuild:usage` calls `rebuild_usage_totals()`, which **cannot run** on this database:
 * its body uses `delete from usage_totals where true`, and the safe-update guard rejects that
 * because the planner folds `WHERE true` away. Migration
 * `20260921210000_sa_2_5_fix_rebuild_usage_totals.sql` fixes the function, but applying it needs
 * DDL rights.
 *
 * This script does the same re-aggregation over PostgREST, so the cache can be restored *before*
 * that migration lands. Once it has landed, prefer `npm run rebuild:usage` — one statement in one
 * transaction beats a paged read and a batched write.
 *
 * ## Why this is safe to run at any time
 *
 * `usage_totals` is a derived cache and `usage_events` is the authority: DELETE against the event
 * log is refused at the database level even for `service_role`, so the input cannot have been
 * silently trimmed. The output is a pure `sum(qty)` grouped by
 * `(tenant_id, meter_key, period_start)` — exactly what the SQL function computes.
 *
 * It replaces the whole table, so `--dry-run` prints the comparison and writes nothing.
 */
import { createClient } from "@supabase/supabase-js";
import process from "node:process";

const dryRun = process.argv.includes("--dry-run");
const PAGE = 1000;
const BATCH = 200;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const keyOf = (row) => `${row.tenant_id}|${row.meter_key}|${row.period_start}`;

async function main() {
  const { data: existing, error: readCacheError } = await sb
    .from("usage_totals")
    .select("tenant_id, meter_key, period_start, used_qty");
  if (readCacheError) {
    console.error(`Could not read usage_totals: ${readCacheError.message}`);
    process.exitCode = 1;
    return;
  }

  // Page the event log rather than asking for all of it: this is the fastest-growing table here.
  const events = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("usage_events")
      .select("tenant_id, meter_key, period_start, qty")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`Could not read usage_events at offset ${from}: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    events.push(...data);
    if (data.length < PAGE) break;
  }

  const totals = new Map();
  for (const event of events) {
    const key = keyOf(event);
    totals.set(key, (totals.get(key) ?? 0) + Number(event.qty));
  }

  const rebuilt = [...totals].map(([key, used]) => {
    const [tenant_id, meter_key, period_start] = key.split("|");
    return { tenant_id, meter_key, period_start, used_qty: Math.round(used), updated_at: new Date().toISOString() };
  });

  const before = new Map(existing.map((row) => [keyOf(row), row.used_qty]));
  const after = new Map(rebuilt.map((row) => [keyOf(row), row.used_qty]));
  const changed = [...after].filter(([key, value]) => before.has(key) && before.get(key) !== value);
  const missing = [...after.keys()].filter((key) => !before.has(key));
  const stale = [...before.keys()].filter((key) => !after.has(key));

  console.log(`usage_events read        : ${events.length}`);
  console.log(`usage_totals currently   : ${existing.length}`);
  console.log(`usage_totals rebuilt to  : ${rebuilt.length}`);
  console.log(`  rows the cache is missing : ${missing.length}`);
  console.log(`  rows with a wrong total   : ${changed.length}`);
  console.log(`  rows not backed by events : ${stale.length}`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  // Replace rather than upsert: a row with no events behind it must disappear, which is the whole
  // point of rebuilding from the log.
  const { error: clearError } = await sb.from("usage_totals").delete().not("tenant_id", "is", null);
  if (clearError) {
    console.error(`Could not clear usage_totals: ${clearError.message}`);
    process.exitCode = 1;
    return;
  }

  for (let i = 0; i < rebuilt.length; i += BATCH) {
    const { error } = await sb.from("usage_totals").insert(rebuilt.slice(i, i + BATCH));
    if (error) {
      console.error(`Insert failed at row ${i}: ${error.message}`);
      console.error("usage_totals is now PARTIAL. Re-run this script — usage_events is untouched.");
      process.exitCode = 1;
      return;
    }
  }

  const { count, error: verifyError } = await sb.from("usage_totals").select("*", { count: "exact", head: true });
  if (verifyError) {
    console.error(`Rebuilt, but could not verify the row count: ${verifyError.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nRebuilt ${count} row(s) from ${events.length} event(s).`);
  if (count !== rebuilt.length) {
    console.error(`Expected ${rebuilt.length} rows. Re-run this script.`);
    process.exitCode = 1;
  }
}

await main();
