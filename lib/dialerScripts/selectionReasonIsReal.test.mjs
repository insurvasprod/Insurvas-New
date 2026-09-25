// Run with: npm test
//
// LA-2.13 / LA-2.14 audit, 2026-09-22.
//
// ── The defect ─────────────────────────────────────────────────────────────────────────────────
//
// LA-2.13 criterion 1 is "every served lead carries the reason it was chosen, in plain language",
// and the dialer has a card titled "Why this lead?" for exactly that. It read:
//
//   db.from("outbound_scoring_decisions").select("selection_reason, served_at")
//     .eq("tenant_id", …).eq("lead_id", …)
//
// `outbound_scoring_decisions` is the LEGACY CRM's table, on the organizations plane. It is keyed
// by `organization_id` and `prospect_id` and has neither `tenant_id` nor `lead_id`, so the query
// failed on every call. Measured against the live database:
//
//   outbound_scoring_decisions  ERROR 42703 — column outbound_scoring_decisions.tenant_id does not exist
//   tenant_scoring_decisions    ok
//
// The error was then swallowed — `selectionResult.error ? null : …` — and rendered as
// "No selection explanation is available for this lead". A permanent failure wearing the clothes of
// an empty state, on the one card whose whole job is to answer the criterion. The comment above it
// said the table was "optional in older shared-project snapshots", which is a true sentence about a
// different table and is why nobody looked again.
//
// ── Why the guard is general ───────────────────────────────────────────────────────────────────
//
// The specific fix is one identifier. The reusable lesson is that this repository contains 189
// tables from the organizations-plane CRM which are keyed by `organization_id`, many with names a
// tenant-plane author would plausibly reach for, and filtering any of them by `tenant_id` produces
// exactly this failure. So the guard walks all of them rather than pinning the one that bit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = process.cwd();
const LEGACY_SCHEMA = "supabase/backups/schema-before-2026-09-11.sql";

function sources(dir) {
  const absolute = join(ROOT, dir);
  const found = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (["node_modules", ".next"].includes(entry.name)) continue;
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sources(child));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) found.push(child);
  }
  return found;
}

const appSources = ["lib", "app", "components"]
  .flatMap(sources)
  .filter((path) => !path.endsWith("database.types.ts"))
  .map((path) => [path, readFileSync(join(ROOT, path), "utf8")]);

const byPath = new Map(appSources);

/** Tables the legacy CRM owns: keyed by organization_id, with no tenant_id anywhere in the body. */
function legacyTables() {
  const file = join(ROOT, LEGACY_SCHEMA);
  if (!existsSync(file)) return null;
  const sql = readFileSync(file, "utf8");
  const names = new Set();
  const create = /create table if not exists public\.([a-z0-9_]+) \(([\s\S]*?)\n\);/g;
  let match;
  while ((match = create.exec(sql)) !== null) {
    const [, name, body] = match;
    if (/\borganization_id\b/.test(body) && !/\btenant_id\b/.test(body)) names.add(name);
  }
  return names;
}

test("no tenant-plane query filters a legacy organizations-plane table by tenant_id", () => {
  const legacy = legacyTables();
  if (!legacy) return; // the snapshot is not checked out; nothing to compare against
  assert.ok(legacy.size > 50, `only ${legacy.size} legacy tables parsed — the scan is broken, not the app`);

  const offenders = [];
  for (const [path, source] of appSources) {
    for (const table of legacy) {
      // `.from("legacy_table")` and, within the SAME statement, a tenant_id filter. That query
      // cannot succeed: the column does not exist on that table.
      //
      // The window stops at the next `from(`, which matters: a first draft of this scan spanned
      // statement boundaries and reported five builders that were innocent — `db.from("users")`
      // on one line of a Promise.all and `.eq("tenant_id", …)` on the next belong to two different
      // queries. A guard that cries wolf gets its allowlist padded until it means nothing.
      const pattern = new RegExp(
        `from\\(\\s*["'\`]${table}["'\`]\\s*\\)(?:(?!from\\()[\\s\\S]){0,300}?eq\\(\\s*["'\`]tenant_id`,
      );
      if (pattern.test(source)) offenders.push(`${path}: filters ${table} by tenant_id`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `queries that can only ever fail, because the table is keyed by organization_id:\n  ${offenders.join("\n  ")}`,
  );
});

test("the dialer panel reads the decisions this product writes", () => {
  const service = byPath.get("lib/dialerScripts/service.ts");
  assert.ok(service, "the dialer script service is gone");
  assert.match(
    service,
    /from\("tenant_scoring_decisions"\)\.select\("selection_reason/,
    "the selection reason no longer comes from the table serve_next_lead writes",
  );
  assert.doesNotMatch(
    service,
    /from\("outbound_scoring_decisions"\)/,
    "the legacy CRM's decisions table is back",
  );
});

test("a failed selection-reason lookup is raised, not rendered as an absent reason", () => {
  const service = byPath.get("lib/dialerScripts/service.ts");
  // This is the half that let the wrong table survive a whole module. A lead that has never been
  // served legitimately has no reason; a query that FAILED does not, and the two must not render
  // the same.
  assert.doesNotMatch(
    service,
    /selectionResult\.error \? null :/,
    "every error is being swallowed into a null reason again",
  );
  assert.match(service, /function selectionReason\(/);
  assert.match(
    service,
    /throw new Error\(`Could not load the selection reason/,
    "a real failure no longer surfaces",
  );
  // Only a genuinely absent relation is tolerated, so the panel still opens on a snapshot without
  // LA-2.13 applied.
  assert.match(service, /PGRST205|Could not find the table/);
});

test("the outbound deal files against somebody's local date, not UTC's", () => {
  // LA-2.14 criterion 5, "an outbound sale appears CORRECTLY in the daily deal flow", and LA-1.7
  // criterion 5 before it: "the deal-flow date is correct for an agent working late in their own
  // timezone". `deal_flow.local_date` defaults to `current_date`, which is UTC on every connection
  // this product makes, and the outbound insert omitted the column — so for a Pacific tenant the
  // whole evening calling block filed against tomorrow.
  const dir = join(ROOT, "supabase/migrations");
  const migrations = readdirSync(dir).filter((name) => name.endsWith(".sql"));

  const handoff = migrations.find((name) => name.includes("la_2_14_outbound_application_handoff"));
  assert.ok(handoff, "the LA-2.14 handoff migration is gone");

  const fixed = migrations.some((name) =>
    readFileSync(join(dir, name), "utf8").includes("deal_local_date"),
  );
  assert.ok(
    fixed,
    "nothing computes a local date for the outbound deal-flow row, so it takes the UTC default",
  );
});

test("the attribution chain ends at the issued policy, and at only one policy table", () => {
  // LA-2.14 criterion 2: "campaign_id and vendor_id survive onto the application AND THE POLICY
  // RECORD" — justified on the task page with "this is what makes cost per issued policy
  // computable". The chain view stopped at deal_flow.
  //
  // It ends at `tenant_issued_policies`, which LA-2.17 built for exactly this and which carries
  // campaign_id, vendor_id and an attribution-enforcing trigger. NOT at `tenant_policies`, the
  // serviced book of business — LA-2.17 declined to extend that one and said why: "a fabricated
  // policy count would make vendor selection worse than an honest empty report." Two attribution
  // chains that can disagree about which campaign produced a policy is worse than one that
  // sometimes says "unknown", so this asserts the second one has not been reintroduced.
  const dir = join(ROOT, "supabase/migrations");
  const chain = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .filter((body) => body.includes("create or replace view public.tenant_lead_attribution_chain"))
    .pop();
  assert.ok(chain, "no migration defines the attribution chain view");

  const view = chain.slice(chain.lastIndexOf("create or replace view public.tenant_lead_attribution_chain"));
  const body = view.slice(0, view.indexOf(";") + 1);
  assert.match(body, /join tenant_issued_policies/, "the chain does not reach the issued policy");
  assert.doesNotMatch(
    body,
    /join tenant_policies\b/,
    "the chain reads the serviced book of business; that is a second attribution path",
  );
  assert.match(body, /policy_attribution_lost/, "a policy that lost its campaign is not reported");
});
