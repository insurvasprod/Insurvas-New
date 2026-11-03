/**
 * A whole-function `create or replace` silently reverts every later fix to that function.
 *
 * This is not hypothetical. The exact sequence, from this repository:
 *
 *   20260914160000  la_2_2_atomic_lead_import           actor check reads `public.users.tenant_id`
 *   20260914193000  la_2_2_import_actor_membership_fix  corrected to `tenant_users` — and the live
 *                                                       database has this, verified via pg_proc
 *   20260917141000  la_2_2_twenty_thousand_row_batch    re-emitted the function from the 160000 text
 *   20260917146000  la_2_2_imported_leads_reach_the_dialer    same
 *
 * The last two raised the batch cap and added the queue enqueue, and to do it they pasted the whole
 * function body — carrying the pre-fix actor check back with them. `public.users` has **no**
 * `tenant_id` column; membership lives in `tenant_users`. PL/pgSQL resolves column references when
 * the function runs, not when it is created, so both migrations would have applied without
 * complaint and then raised `42703 column "tenant_id" does not exist` on every single import.
 *
 * Applying those migrations would therefore have *introduced* the defect that a migration three days
 * earlier existed to remove, and taken list import down entirely in the process.
 *
 * So this test does not check "the fix exists" — it did exist. It checks that the **last** migration
 * to define the function still has it, which is the only version the database will end up with.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();

/** A repository file, by path segments. */
const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

/** The last migration that redefines `name`, which is the one the database ends up running. */
function latestDefining(name) {
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const body = readFileSync(join(MIGRATIONS, files[i]), "utf8");
    if (new RegExp(`create or replace function public\\.${name}\\b`).test(body)) {
      return { name: files[i], body };
    }
  }
  return null;
}

test("the last definition of import_agent_lead_batch checks membership in tenant_users", () => {
  const latest = latestDefining("import_agent_lead_batch");
  assert.ok(latest, "no migration defines import_agent_lead_batch");

  const actor = latest.body.slice(
    latest.body.indexOf("if not exists"),
    latest.body.indexOf("IMPORT_ACTOR_INVALID"),
  );
  assert.ok(actor.length > 0, `${latest.name} has no IMPORT_ACTOR_INVALID guard at all`);

  assert.match(
    actor,
    /from public\.tenant_users tu/,
    `${latest.name} does not resolve the actor through tenant_users`,
  );
  assert.doesNotMatch(
    actor,
    /public\.users\s*\n?\s*where id = p_created_by and tenant_id = p_tenant_id/,
    `${latest.name} reverted to users.tenant_id — a column that does not exist, so every import raises 42703`,
  );
  // The status gate is part of the same contract: a deactivated user must not be able to import.
  assert.match(actor, /u\.status in \('active', 'invited'\)/, `${latest.name} dropped the actor status gate`);
});

test("no migration after the actor-membership fix uses the pre-fix shape", () => {
  // The original 20260914160000 keeps its text — migrations are history and are not edited. What
  // must not happen is a LATER file carrying that shape forward, which is the regression this whole
  // file exists for.
  const FIX = "20260914193000";
  const offenders = [];
  for (const name of files) {
    if (name.slice(0, 14) <= FIX) continue;
    const body = readFileSync(join(MIGRATIONS, name), "utf8");
    if (!/create or replace function public\.import_agent_lead_batch\b/.test(body)) continue;
    if (/from public\.users\s*\n?\s*where id = p_created_by and tenant_id = p_tenant_id/.test(body)) {
      offenders.push(name);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these migrations re-emit the pre-fix actor check and would revert ${FIX}: ${offenders.join(", ")}`,
  );
});


/**
 * The general form of the same mistake, with the detector proved against a known case first.
 *
 * Membership is a `tenant_users` row; `public.users` carries identity and status only. Any statement
 * that filters `users` by `tenant_id` is reaching for a column that is not there and will only find
 * out when it runs.
 *
 * Two things this has to get right, and a first attempt got both wrong:
 *
 *   · It must not match another table's column. One regex over a 240-character window matched
 *     `q.tenant_id = p_tenant_id` in LA-2.24's assignment function, because a word boundary happily
 *     starts a match in the middle of `q.tenant_id`. That column belongs to `lead_queue` and is
 *     correct, so the naive detector failed on working code.
 *   · It must be proved non-vacuous. The second attempt had a mangled pattern that matched nothing
 *     at all, and passed — which is worse than failing, because it reads as evidence.
 *
 * So `findOffenders` is run against `20260914160000` first, where the defect is known to be, and the
 * test fails if the detector cannot see it.
 */
const BROKEN_ORIGINAL = "20260914160000_la_2_2_atomic_lead_import.sql";

/** Every `from public.users …` whose statement filters that relation by `tenant_id`. */
function findOffenders(fileNames) {
  const offenders = [];
  for (const name of fileNames) {
    const body = readFileSync(join(MIGRATIONS, name), "utf8");
    const from = /from\s+public\.users(?:\s+(?:as\s+)?(?!where\b|on\b|join\b|group\b|order\b|limit\b|for\b)([a-z_][a-z0-9_]*))?/gi;
    let match;
    while ((match = from.exec(body)) !== null) {
      const alias = match[1] ?? null;
      const window = body.slice(match.index, match.index + 240);
      // A join to tenant_users in the same statement means any tenant_id belongs to that table.
      if (/tenant_users/i.test(window)) continue;
      // Qualified by THIS relation, or unqualified. The lookbehind is what stops a match starting
      // inside some other table's `x.tenant_id`.
      const quals = ["users\\.", ...(alias ? [`${alias}\\.`] : [])].join("|");
      const pattern = new RegExp(`(?:(?:${quals})|(?<![.\\w]))tenant_id\\s*=`, "i");
      if (pattern.test(window)) offenders.push(`${name}${alias ? ` (alias ${alias})` : ""}`);
    }
  }
  return offenders;
}

test("the users.tenant_id detector actually detects it", () => {
  // Non-vacuity. Without this, a pattern that matches nothing passes the test below and looks like
  // proof. That already happened once while writing this file.
  const caught = findOffenders([BROKEN_ORIGINAL]);
  assert.deepEqual(
    caught,
    [BROKEN_ORIGINAL],
    "the detector cannot see the known defect in 20260914160000, so the next test proves nothing",
  );
});

test("public.users is never filtered by a tenant_id column anywhere in the schema", () => {
  // 20260914160000 keeps its text: migrations are history and are not edited. It is superseded by
  // 20260914193000 and by every later definition, so it is excluded here by name rather than by
  // weakening the detector. Anything else is a live defect.
  const offenders = findOffenders(files).filter((entry) => !entry.startsWith("20260914160000"));
  assert.deepEqual(
    offenders,
    [],
    `these filter public.users by a tenant_id column that does not exist: ${offenders.join(", ")}`,
  );
});

test("a database-contract import failure is recorded, not just handled", () => {
  // The companion defect to the actor-shape one, and the reason it stayed invisible.
  //
  // All three import routes classified the error and then dropped it in the same expression:
  //
  //     const failure = classifyImportFailure(error);
  //     return NextResponse.json({ error: failure.message, ... }, { status: failure.status });
  //
  // The user got "temporarily unavailable … please try again later" — a permanent schema fault
  // described as a transient one, which invites retrying forever — and the operator got nothing at
  // all. A 503 nobody can diagnose is worse than a 500 with a stack, because it looks handled.
  const errors = read("lib", "agentTemplates", "errors.ts");
  assert.match(errors, /cause: string/, "the classifier discards the original error text");
  assert.match(errors, /export function recordImportFailure/);
  assert.match(errors, /console\.error\(/, "a contract failure must reach the log");
  // It must also stay importable from a plain `node --test` file — importBatch.test.mjs loads it
  // directly, where `next/server` does not resolve. A framework import here breaks that suite.
  assert.doesNotMatch(errors, /from "next\//, "errors.ts must not import framework modules");

  for (const route of [
    ["app", "api", "app", "leads", "import", "preflight", "route.ts"],
    ["app", "api", "app", "leads", "import", "route.ts"],
  ]) {
    const code = read(...route).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(code, /recordImportFailure\(error, "/, `${route.join("/")} does not route through the recording helper`);
    // Building the response from `failure` is fine — that happens after the cause is recorded. What
    // must not happen is a route reaching for the non-logging classifier and skipping the record.
    assert.doesNotMatch(
      code,
      /classifyImportFailure\(/,
      `${route.join("/")} calls classifyImportFailure directly, so the cause is never written down`,
    );
  }

  // The batch row is the durable record. Storing the vague user message there loses the only
  // evidence that survives the process.
  const direct = read("app", "api", "app", "leads", "import", "route.ts");
  assert.match(direct, /error_message: failure\.cause \|\| failure\.message/);
});
