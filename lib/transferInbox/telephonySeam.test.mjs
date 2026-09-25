// Run with: npm test
//
// Module 1 §16 decides telephony is out of scope and then asks for three cheap precautions, "all
// worth taking now", so it can be added later without a rewrite:
//
//   1. Keep an `active_call` record even without a provider.
//   2. Leave a `provider_call_id` column on it, nullable. "One column now saves a migration later."
//   3. Never let call state be inferred from work-item state.
//
// Two were taken and one was not. `public.active_calls` exists and the Agent Floor reads it, but the
// column did not, until 20260922210000.
//
// ── Why this needs a guard and not just a column ────────────────────────────────────────────────
//
// `provider_call_id` is read by nothing, on either plane, and that is deliberate — it is a seam, not
// a feature. A column nothing reads is exactly what a later tidy-up removes, and the cost of
// removing it is not the column: it is that `active_calls` gains a row on every claim, so by the
// time a provider arrives the table has history in it and adding the column back means a backfill
// against live call records. The outbound migration makes the same argument in its own words —
// "leaving the column out until one arrives would mean migrating a table that by then has history
// in it."
//
// So this asserts the seam stays open on BOTH planes, and that it stays nullable, because a NOT NULL
// provider id on a table written at claim time would make every claim depend on a provider that
// does not exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");

/** Every migration body, oldest first, excluding the legacy-CRM snapshot. */
const bodies = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => [name, readFileSync(join(MIGRATIONS, name), "utf8")]);

function columnIsAdded(table, column) {
  // A single `alter table` may add several columns in one statement, with comments between them —
  // the outbound seam is the first of three, under its own comment. So the window runs to the
  // statement terminator rather than expecting the column to follow the table name directly, and
  // stops at `;` so a later ALTER on a different table cannot satisfy this one.
  const pattern = new RegExp(
    `alter table (?:public\\.)?${table}\\b[^;]*?add column if not exists ${column}\\b`,
    "i",
  );
  return bodies.some(([, body]) => pattern.test(body));
}

function columnIsDropped(table, column) {
  const pattern = new RegExp(`alter table (?:public\\.)?${table}[\\s\\S]{0,120}?drop column[^;]*\\b${column}\\b`, "i");
  return bodies.some(([, body]) => pattern.test(body));
}

test("the inbound call record carries a telephony seam", () => {
  assert.ok(
    columnIsAdded("active_calls", "provider_call_id"),
    "active_calls has no provider_call_id — Module 1 §16 precaution 2 asks for exactly this column",
  );
  assert.ok(
    !columnIsDropped("active_calls", "provider_call_id"),
    "the inbound telephony seam was removed; it is unused on purpose, and active_calls gains a row " +
      "per claim, so putting it back later means backfilling live call history",
  );
});

test("the outbound call record still carries its own seam", () => {
  // The same precaution, taken by LA-2.9 under a header reading "THE SEAM". Asserted here too so
  // both planes fail together rather than one quietly losing it.
  assert.ok(
    columnIsAdded("tenant_call_attempts", "provider_call_id"),
    "tenant_call_attempts has no provider_call_id — the outbound telephony seam is gone",
  );
  assert.ok(
    !columnIsDropped("tenant_call_attempts", "provider_call_id"),
    "the outbound telephony seam was removed",
  );
});

test("neither seam is made required while telephony is out of scope", () => {
  // `not null` on either would make the write that opens a call depend on a provider that does not
  // exist yet — the precaution inverted into a blocker.
  const offenders = [];
  for (const [name, body] of bodies) {
    for (const table of ["active_calls", "tenant_call_attempts"]) {
      const pattern = new RegExp(
        `alter (?:table|column)[\\s\\S]{0,160}?${table}[\\s\\S]{0,160}?provider_call_id[\\s\\S]{0,60}?set not null`,
        "i",
      );
      if (pattern.test(body)) offenders.push(`${name}: ${table}.provider_call_id`);
    }
  }
  assert.deepEqual(offenders, [], `a telephony seam was made required:\n  ${offenders.join("\n  ")}`);
});

test("call state is read from the call record, never inferred from the work item", () => {
  // §16 precaution 3, and the failure it exists to prevent: "the existing system conflated the two
  // and rows sat in 'agent active' for hours after the call ended."
  const floor = readFileSync(join(ROOT, "lib", "agentFloor", "service.ts"), "utf8");
  assert.match(
    floor,
    /from\("active_calls"\)/,
    "the Agent Floor no longer reads active_calls, so 'who is on a call' is being inferred elsewhere",
  );
  // The specific inference that was wrong before: deriving "on a call" from the queue row's status.
  assert.doesNotMatch(
    floor,
    /on_call["']?\s*:\s*[^,;\n]*lead_queue/,
    "call state is being derived from the work item's status again",
  );
});
