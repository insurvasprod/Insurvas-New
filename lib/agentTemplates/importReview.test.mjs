/**
 * Module 2 §5 and §6 · the vendor → campaign → list → leads chain, and the decision step.
 *
 * Two gaps this file pins.
 *
 * **§5 had no forms.** `VENDOR ────┬──► CAMPAIGN ────► LIST (import) ────► LEADS` is the chain the
 * whole cost analysis hangs off, and both ends of it were API-only: a tenant could not create the
 * vendor they buy from, nor the campaign that carries its cost. Without a campaign every imported
 * lead is free, so cost per record, cost per usable record and cost per issued policy are all empty.
 *
 * **§6 ran steps ④⑤⑥ inside the commit.** The documented pipeline validates, dedupes and scrubs
 * *before* it commits, and "④ validate — show him what is wrong BEFORE he commits" is the whole
 * point. Running them inside the write meant Ray learned what his file contained from a toast after
 * it had been dealt with on his behalf.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("a vendor and a campaign can be created from the screen, not only the API", () => {
  const workspace = read("components", "app", "campaign-workspace.tsx");
  // The New vendor form lives in the vendor roster (Vendors concept build, 2026-09-25).
  const roster = read("components", "app", "vendor-roster.tsx");
  assert.match(workspace, /<NewVendorPanel /);
  assert.match(roster, /async function createVendor\(/);
  assert.match(workspace, /async function createCampaign\(/);
  assert.match(roster, /fetch\("\/api\/app\/vendors", \{[\s\S]{0,60}method: "POST"/);

  // A campaign belongs to a vendor — §5's hierarchy — so the form picks one rather than accepting
  // a free-text name that would strand the campaign outside the rollup.
  assert.match(workspace, /id="campaign-vendor"/);
  // Active and under-review vendors take campaigns (user decision, Vendors concept build); the rule
  // lives in one place, and a retired vendor is still never offered.
  assert.match(workspace, /vendors\.filter\(\(vendor\) => vendorTakesCampaigns\(vendor\.status\)\)/);
  assert.match(workspace, /vendorCampaignWarning\(picked\.status, picked\.name\)/);
  const types = read("lib", "vendors", "types.ts");
  assert.match(types, /return status === "active" \|\| status === "under_review";/);

  // New campaigns start as drafts. A campaign serves leads only when it is active AND scrubbed, so
  // creating one active would put an empty, unscrubbed campaign into the serving view.
  assert.match(workspace, /status: "draft"/);
});

test("the import stages the file and redirects instead of writing it", () => {
  const workspace = read("components", "app", "lead-import-workspace.tsx");
  // The old behaviour: POST /api/app/leads/import wrote the leads in one request.
  assert.match(workspace, /api\/app\/leads\/import\/preflight/);
  assert.match(workspace, /router\.push\(`\/app\/import\/review\/\$\{body\.batchId\}`\)/);
  // The button no longer claims to import, because it no longer does. (Renamed from "Check and
  // review" to the board's "Continue to review" — same promise, nothing is written.)
  assert.doesNotMatch(workspace, /`Import \$\{validation\.validRows/);
  assert.match(workspace, /Continue to review/);
});

test("a phone that fails validation no longer blocks the whole file", () => {
  // It used to: any rejected row disabled the button, so one bad number in 5,000 stopped the import.
  // The row is filed under "Phone failed validation" on the review and left out instead.
  const workspace = read("components", "app", "lead-import-workspace.tsx");
  assert.doesNotMatch(workspace, /rejectedRows \?\? 0\) > 0/);
  const csv = read("lib", "agentTemplates", "csv.ts");
  assert.match(csv, /export class LeadImportPhoneError extends Error/);
  assert.match(csv, /kind: error instanceof LeadImportPhoneError \? "invalid_phone" : "unreadable"/);
  const service = read("lib", "agentTemplates", "importPreflight.ts");
  assert.match(service, /error\.kind === "invalid_phone" \? "invalid_phone" : "unreadable"/);
});

test("the storage warning shows only when this tab cannot hold the file", () => {
  const workspace = read("components", "app", "lead-import-workspace.tsx");
  // Probed on mount, not discovered after the scrub has already run.
  assert.match(workspace, /useSyncExternalStore\(noSubscription, sessionStorageWorks, \(\) => true\)/);
  assert.match(workspace, /\{!storageOk && <Callout tone="warning" title="This browser will not hold the file between pages">/);
});

test("the preflight writes no leads, and the commit is a separate call", () => {
  const service = read("lib", "agentTemplates", "importPreflight.ts");
  const preflight = service.slice(
    service.indexOf("export async function preflightImport"),
    service.indexOf("export async function loadPreflight"),
  );
  // Step ⑧ is the only step that writes, and it is not in this function.
  assert.doesNotMatch(preflight, /import_agent_lead_batch/, "the preflight must not commit leads");
  assert.match(preflight, /screenPartnerPhone/);

  const route = read("app", "api", "app", "leads", "import", "preflight", "route.ts");
  assert.match(route, /export async function POST\(/);
  assert.match(route, /export async function PUT\(/);
  assert.match(route, /preflightImport/);
  assert.match(route, /commitImport/);
});

test("a number is screened once per file, and the commit reuses the answer", () => {
  const service = read("lib", "agentTemplates", "importPreflight.ts");
  // The scrub is metered against the plan (LA-2.22), so screening at preflight and again at commit
  // would bill twice for one file.
  const commit = service.slice(service.indexOf("export async function commitImport"));
  assert.doesNotMatch(commit, /screenPartnerPhone/, "the commit must not re-screen");
  assert.match(commit, /plan\.screened\[phone\]/);

  // And the distinct phone count is what the allowance is checked against, because two rows for one
  // number are one lookup.
  assert.match(service, /assertOutboundLimit\(input\.tenantId, "dnc_scrub_lookups", distinctPhones\.length\)/);
});

test("re-uploading the same file reuses its plan rather than scrubbing again", () => {
  const service = read("lib", "agentTemplates", "importPreflight.ts");
  assert.match(service, /\.eq\("idempotency_key", key\)/);
  assert.match(service, /existing\.status === "processing" && plan\?\.kind === "preflight"/);
});

test("the reuse key is the file AND the choices, so a new campaign is never answered with an old plan", () => {
  // Keyed on the file's hash alone, staging the same file again under a different campaign reused
  // the old plan and committed the leads to the campaign the person had just moved away from.
  const service = read("lib", "agentTemplates", "importPreflight.ts");
  const key = service.slice(service.indexOf("export function preflightKey"), service.indexOf("function leadName"));
  for (const part of ["csvHash", "campaignId", "vendorId", "mapping", "costCents", "recordsPurchased"])
    assert.match(key, new RegExp(`input\\.${part}`), `the reuse key ignores ${part}`);
  assert.doesNotMatch(service, /idempotency_key: `preflight:\$\{csvHash\}`/);
});

test("re-staging a file that was already committed says so instead of a raw 23505", () => {
  const service = read("lib", "agentTemplates", "importPreflight.ts");
  const preflight = service.slice(service.indexOf("export async function preflightImport"), service.indexOf("export async function loadPreflight"));
  assert.match(preflight, /existing\.status === "completed"\) throw new ImportConflictError/);
  assert.match(preflight, /inserted\.error\?\.code === "23505"/);
  const route = read("app", "api", "app", "leads", "import", "preflight", "route.ts");
  assert.match(route, /error instanceof ImportConflictError/);
  assert.match(route, /status: 409/);
});

test("the dedupe asks about the file's numbers instead of reading every lead", () => {
  // PostgREST caps a response at max-rows (1,000 hosted by default), and the service client does not
  // page, so `select id, values from agent_leads where tenant_id = …` saw the first thousand of
  // ~214k leads and the "already one of your leads" check missed everybody else.
  const service = read("lib", "agentTemplates", "importPreflight.ts");
  const code = service.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /from\("agent_leads"\)\.select\("id, values"\)\.eq\("tenant_id", input\.tenantId\);/);
  assert.match(code, /rpc\("import_existing_lead_phones"/);
  // Before the migration: an IN-query on just this file's numbers, never the whole table.
  assert.match(code, /\.in\(column, variants\)/);

  const migration = read("supabase", "migrations", "20260924330000_import_batch_cost_and_phone_lookup.sql");
  assert.match(migration, /create or replace function public\.import_existing_lead_phones/);
  assert.match(migration, /returns jsonb/, "a set-returning lookup would hit the same row cap");
  assert.match(migration, /grant execute on function public\.import_existing_lead_phones\(uuid, text\[\]\) to service_role/);
});

test("screening runs a bounded number at a time", () => {
  const service = read("lib", "agentTemplates", "importPreflight.ts");
  assert.match(service, /const SCREENING_CONCURRENCY = 20;/);
  assert.match(service, /mapWithConcurrency\(distinctPhones, SCREENING_CONCURRENCY/);
});

test("the plan records where a DNC hit came from and which rows are in each bucket", () => {
  const service = read("lib", "agentTemplates", "importPreflight.ts");
  assert.match(service, /dncSource: decision\.outcome === "dnc" \? \(decision\.resultId \? "registry" : "tenant"\) : null/);
  assert.match(service, /answer\.dncSource === "tenant" \? "dnc_tenant" : "dnc_registry"/);
  assert.match(service, /bucketRows\[bucket\]\.push\(row\.rowNumber\)/);
});

test("decisions cannot be applied to a different file than the one reviewed", () => {
  const service = read("lib", "agentTemplates", "importPreflight.ts");
  // The CSV is re-sent at commit rather than stored, so the hash is what makes that safe.
  assert.match(service, /plan\.csvHash !== hashCsv\(input\.csv\)/);
  assert.match(service, /The file has changed since it was reviewed/);
});

test("a litigator can never be imported, whatever was chosen", () => {
  const service = read("lib", "agentTemplates", "importPreflight.ts");
  const commit = service.slice(service.indexOf("export async function commitImport"));
  // Module 2 §8.1: "Never dialable. Never overridable." So it is not a decision at all — there is no
  // branch on `input.decisions` for it.
  const litigator = commit.slice(commit.indexOf('answer?.outcome === "tcpa_litigator"'), commit.indexOf('answer?.outcome === "invalid_phone"'));
  assert.doesNotMatch(litigator, /input\.decisions/);
  assert.match(litigator, /summary\.excluded \+= 1/);
  // Recorded as claimable, because Ray paid for the row.
  assert.match(litigator, /rejections\.push/);

  const decisions = read("lib", "agentTemplates", "importPreflight.ts");
  assert.doesNotMatch(decisions, /litigator: "(import|allow|dial)/);
});

test("a DNC number can be kept as a record but never made dialable", () => {
  const service = read("lib", "agentTemplates", "importPreflight.ts");
  // Two options and only two. `suppress` keeps the row as evidence and writes the number to the
  // internal do-not-call list; there is deliberately no option that leaves it dialable, because
  // Module 2 §8.1 permits that only with a documented relationship or written consent.
  assert.match(service, /dnc: "exclude" \| "suppress"/);
  assert.match(service, /suppressions\.push/);
  assert.match(service, /rpc\("suppress_phone"/);

  const route = read("app", "api", "app", "leads", "import", "preflight", "route.ts");
  assert.match(route, /dnc: z\.enum\(\["exclude", "suppress"\]\)/);

  const review = read("components", "app", "import-review-workspace.tsx");
  assert.match(review, /There is no option to dial these/);
});

test("a suppression that fails is reported, never swallowed", () => {
  const service = read("lib", "agentTemplates", "importPreflight.ts");
  // A lead imported as suppressed whose suppression did not land is a dialable DNC number, which is
  // the single outcome this path exists to prevent.
  assert.match(service, /Suppress it by hand before dialing this campaign/);
});

test("the review screen shows every group and what each choice will do", () => {
  const review = read("components", "app", "import-review-workspace.tsx");
  for (const group of ["ready", "litigator", "invalid_phone", "dnc", "duplicate_existing", "duplicate_in_file", "unreadable"]) {
    assert.match(review, new RegExp(`outcome: "${group}"`), `the review screen has no ${group} group`);
  }
  // The number moves as the choices change, because a total that does not respond is not an
  // explanation of what the option does. It is now computed by `reviewOutcome`, which also knows
  // which DNC rows would be new, attached or repeats — the old formula added every DNC row.
  assert.match(review, /reviewOutcome\(counts, plan\.dncBreakdown, \{ duplicatesInFile, existingLeads, dnc \}\)/);
  assert.match(review, /const willImport = outcome\.willImport/);
  assert.match(review, /`Import \$\{willImport\.toLocaleString\(\)\} lead/);
  // And it says plainly that nothing has happened yet.
  assert.match(review, /Nothing has been written until you press this/);
  // The decisions live under their table rows.
  assert.match(review, /aria-expanded=\{expanded\}/);
});

test("what the review adds up is exact, and the footer's check is a real check", async () => {
  const { reviewOutcome, EMPTY_BUCKETS } = await import("./importReviewModel.ts");
  const counts = { ...EMPTY_BUCKETS, ready: 10, duplicate_existing: 3, duplicate_in_file: 2, dnc_tenant: 2, dnc_registry: 3, litigator: 1, invalid_phone: 1, unreadable: 1 };
  const total = 23;
  // Of the five DNC rows: two numbers are new (one appears twice), one row is someone you already have.
  const dnc = { new: 2, existing: 2, repeat: 1 };

  const leave = reviewOutcome(counts, dnc, { duplicatesInFile: "first", existingLeads: "attach", dnc: "exclude" });
  assert.deepEqual([leave.fresh, leave.added, leave.leftOut, leave.willImport], [10, 3, 10, 13]);
  assert.equal(leave.fresh + leave.added + leave.leftOut, total);

  const suppress = reviewOutcome(counts, dnc, { duplicatesInFile: "first", existingLeads: "attach", dnc: "suppress" });
  assert.deepEqual([suppress.fresh, suppress.added, suppress.leftOut], [12, 5, 6]);
  assert.equal(suppress.fresh + suppress.added + suppress.leftOut, total);
  // Suppressed imports are never dialable, so they are not in "effective per dialable".
  assert.equal(suppress.dialable, 13);

  const skip = reviewOutcome(counts, dnc, { duplicatesInFile: "skip", existingLeads: "skip", dnc: "suppress" });
  assert.deepEqual([skip.fresh, skip.added, skip.leftOut], [12, 0, 11]);
  assert.equal(skip.fresh + skip.added + skip.leftOut, total);
});

test("every import carries a campaign, and the vendor follows it", () => {
  // §5: "Every lead knows its campaign, and every campaign knows its cost." The importer used to
  // offer "No campaign attribution" and then warn about it on review; now it cannot be chosen.
  const workspace = read("components", "app", "lead-import-workspace.tsx");
  assert.doesNotMatch(workspace, /No campaign attribution/);
  assert.match(workspace, /<select id="lead-campaign" className=\{control\} required/);
  // With no campaign to choose, say where to make one rather than blocking silently.
  assert.match(workspace, /title="Create a campaign first"/);
  assert.match(workspace, /href="\/app\/campaigns"/);

  const review = read("components", "app", "import-review-workspace.tsx");
  assert.doesNotMatch(review, /No campaign was selected/);

  const route = read("app", "api", "app", "leads", "import", "preflight", "route.ts");
  assert.match(route, /campaign_id: z\.string\(\)\.uuid\(\),/);
  assert.match(route, /parsed\.data\.vendor_id !== campaignRow\.vendor_id/);
  assert.match(route, /The selected vendor does not own this campaign/);

  const service = read("lib", "agentTemplates", "importPreflight.ts");
  assert.match(service, /if \(!campaignId\) throw new Error\("Choose a campaign for this list/);
});

test("the batch cost is integer cents, bounded, and validated on both sides", async () => {
  const { parseDollarsToCents, parseRecordCount, MAX_BATCH_COST_CENTS } = await import("./importReviewModel.ts");
  assert.equal(parseDollarsToCents(""), null);
  assert.equal(parseDollarsToCents("4,500"), 450_000);
  assert.equal(parseDollarsToCents("$4,500.00"), 450_000);
  assert.equal(parseDollarsToCents("0.29"), 29, "cents are assembled in integers, never through a float");
  assert.equal(parseDollarsToCents(".5"), 50);
  assert.equal(parseDollarsToCents("-1"), "invalid");
  assert.equal(parseDollarsToCents("1.234"), "invalid");
  assert.equal(parseDollarsToCents("abc"), "invalid");
  assert.equal(parseDollarsToCents("1000000.01"), "invalid");
  assert.equal(parseDollarsToCents("1000000"), MAX_BATCH_COST_CENTS);
  assert.equal(parseRecordCount("1,499"), 1499);
  assert.equal(parseRecordCount("1.5"), "invalid");

  const route = read("app", "api", "app", "leads", "import", "preflight", "route.ts");
  assert.match(route, /cost_cents: z\.number\(\)\.int\(\)\.min\(0\)\.max\(MAX_BATCH_COST_CENTS\)/);
  assert.match(route, /records_purchased: z\.number\(\)\.int\(\)\.min\(0\)\.max\(MAX_RECORDS_PURCHASED\)/);

  const columns = read("supabase", "migrations", "20260924330000_import_batch_cost_and_phone_lookup.sql");
  assert.match(columns, /cost_cents between 0 and 100000000/);
  for (const column of ["file_name", "row_count", "cost_cents", "records_purchased", "vendor_id", "campaign_id"])
    assert.match(columns, new RegExp(`add column if not exists ${column}\\b`));
});

test("the campaign's spend moves in the same transaction as the leads, and is audited", () => {
  const files = readdirSync(join(process.cwd(), "supabase", "migrations")).filter((name) => name.endsWith(".sql")).sort();
  const latest = [...files].reverse().find((name) => /create or replace function public\.import_agent_lead_batch/.test(read("supabase", "migrations", name)));
  const body = read("supabase", "migrations", latest);
  // Inside the import function, after the lead loop — not a second round trip from TypeScript.
  assert.match(body, /p_batch_id uuid,\s*p_campaign_spend jsonb/);
  assert.match(body, /set total_spend_cents = c\.total_spend_cents \+ v_spend_cents,\s*records_purchased = c\.records_purchased \+ v_spend_records/);
  assert.match(body, /IMPORT_SPEND_OVERFLOW/);
  // One reviewed batch commits once.
  assert.match(body, /for update;\s*if not found then raise exception 'IMPORT_BATCH_NOT_FOUND'/);
  assert.match(body, /IMPORT_BATCH_ALREADY_COMMITTED/);
  // New leads remember the batch that created them.
  assert.match(body, /screening_checked_at, created_by, import_batch_id/);

  const service = read("lib", "agentTemplates", "importPreflight.ts");
  const commit = service.slice(service.indexOf("export async function commitImport"));
  // The write itself lives in importCommit.ts (LA-2.2-9), which both import paths share.
  const writer = read("lib", "agentTemplates", "importCommit.ts");
  assert.match(commit, /commitLeadImport\(\{[\s\S]*?\bspend,/);
  assert.match(writer, /p_campaign_spend: input\.spend/);
  assert.doesNotMatch((commit + writer).replace(/\/\/[^\n]*/g, ""), /from\("tenant_campaigns"\)\s*\.update\(\{ total_spend_cents/);
  // Without the migration, adding the spend is refused rather than done outside the transaction.
  assert.match(writer, /if \(input\.spend\) throw new ImportCommitRefusal\("spend_needs_migration"/);
  assert.match(commit, /error\.reason === "spend_needs_migration"\)\s*throw new ImportNeedsDatabaseUpdateError/);

  const route = read("app", "api", "app", "leads", "import", "preflight", "route.ts");
  assert.match(route, /action: "tenant\.campaign_spend_added_by_import"/);
  assert.match(read("lib", "audit", "actions.ts"), /"tenant\.campaign_spend_added_by_import":/);

  const review = read("components", "app", "import-review-workspace.tsx");
  assert.match(review, /useState\(true\)/, "Add to the campaign's spend is on by default");
  assert.match(review, /add_to_campaign_spend: addSpend && plan\.costCents !== null/);
});

test("a batch id is not a capability", () => {
  const page = read("app", "app", "(shell)", "import", "review", "[batchId]", "page.tsx");
  // The plan is loaded tenant-scoped server-side, so pasting somebody else's batch id returns a 404
  // rather than their file's contents.
  // One tenant-scoped read (`loadImportReview`) answers both "is there a plan" and "why not" — it
  // replaced loadPreflight + importBatchState, which read the same row twice.
  assert.match(page, /loadImportReview\(tenantId, batchId\)/);
  // Still a 404 for anything that is not this tenant's committed batch. The "already imported"
  // branch is reached only after that tenant-scoped read found the row, so it does not turn a batch
  // id into a way to probe for someone else's.
  assert.match(page, /if \(!plan\) \{/);
  assert.match(page, /!== "committed"\) return notFound\(\)/);

  const service = read("lib", "agentTemplates", "importPreflight.ts");
  const loader = service.slice(service.indexOf("export async function loadImportReview"));
  assert.match(loader, /\.eq\("tenant_id", tenantId\)/);
});

test("the file crosses the redirect in the tab, not in the URL or the database", () => {
  const bridge = read("components", "app", "import-review-bridge.tsx");
  // Twenty thousand rows is megabytes: too big for a query string, and storing it server-side would
  // duplicate every lead record into jsonb for the sake of one screen.
  assert.match(bridge, /sessionStorage\.getItem/);
  // Comments stripped: this file explains why sessionStorage was chosen OVER localStorage, and the
  // prose naming the rejected option must not read as the rejected option being used.
  const code = bridge.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  assert.doesNotMatch(code, /localStorage/);
  // Rendering on the server is the reason this is not an effect.
  assert.match(bridge, /useSyncExternalStore/);
});

test("a committed batch is a finished job, not a 404", () => {
  // Found in the browser pass: after a successful import, pressing Back or refreshing the review URL
  // produced the bare framework 404. A batch nobody staged and a batch already imported are
  // different facts, and only the first one is "not found".
  const service = read("lib", "agentTemplates", "importPreflight.ts");
  assert.match(service, /export async function loadImportReview/);
  assert.match(service, /"staged" \| "committed" \| "missing"/);

  const page = read("app", "app", "(shell)", "import", "review", "[batchId]", "page.tsx");
  const code = page.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // Still a 404 for anything that is not a committed batch of this tenant's — a batch id must not
  // become a way to find out whether someone else's exists.
  assert.match(code, /loadImportReview\(tenantId, batchId\)/);
  assert.match(code, /state !== "committed"\) return notFound\(\)/);
  // The finished state moved into the bridge (a client module) because it styles its links with
  // the primitives' `btn()`, which a server component cannot call.
  assert.match(code, /return <ImportAlreadyImported \/>/);
  assert.match(read("components", "app", "import-review-bridge.tsx"), /already been imported/);
});

test("a failed cost read is not blamed on the campaign the person picked", () => {
  // Observed in the browser pass: a valid, selected campaign returned 400 "Choose a valid campaign"
  // on commit. The campaign was fine — `tenant_campaign_costs` was not deployed. The two cases now
  // read differently, and the failed read classifies as a 503 with "No leads were created" rather
  // than a 400 that sends the person hunting for a campaign fault that does not exist.
  for (const file of [
    ["lib", "agentTemplates", "service.ts"],
    ["lib", "agentTemplates", "importPreflight.ts"],
  ]) {
    const code = read(...file).replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(
      code,
      /if \(campaign\.error \|\| !campaign\.data\)/,
      `${file.join("/")} still collapses a failed read into "invalid campaign"`,
    );
    assert.match(code, /Could not read the cost for this campaign, so nothing was imported/);
    assert.match(code, /if \(!campaign\.data\) throw new Error\("Choose a valid campaign"\)/);
  }
});
