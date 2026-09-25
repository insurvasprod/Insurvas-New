/**
 * Runs every database-backed verification suite in one pass.
 *
 * Every suite on disk is listed here, and the list is the contract: a suite that exists but is not
 * referenced produces no evidence and nobody finds out. That has now happened twice on this project
 * — four LA-0 suites in September, then fifteen more found on 2026-09-12, thirteen of which failed
 * the first time they were ever run. Adding a verify-*.mjs file without adding it here is the
 * defect, not an oversight.
 *
 * This runs the lot and, crucially, does NOT stop at the first failure: one broken suite must not
 * hide the state of all the others.
 *
 * verify-kill-switches-multi.mjs is the single deliberate exclusion, and stays excluded: it needs two
 * running servers rather than a database connection, so it is a separate CI step and a separate npm
 * script. It is the only file in scripts/verify-*.mjs that this list may omit.
 *
 * Exit code is the number of failed suites, capped at 255, so CI fails and a human reading the log
 * sees the count without scrolling.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SUITES = [
  ["tenant isolation", "verify-tenant-isolation.mjs"],
  ["feature keys", "check-feature-keys.mjs"],
  // Runs early on purpose: it names every RPC the code calls that the database lacks, which is
  // usually the explanation for whatever fails further down.
  ["RPC contract", "verify-rpc-contract.mjs"],
  // Also early: a tenant-plane table needs BOTH a grant and a tenant_app policy to be readable.
  // A policy without a grant fails 42501; a grant without a policy returns zero rows and never
  // errors, which is the harder of the two to notice.
  ["tenant_app access", "check-tenant-app-access.mjs"],
  // And: a trigger function can survive a migration while its trigger does not, which is the
  // quietest defect this project produces — the code reads as wired and fires for nothing.
  ["declared triggers", "check-declared-triggers.mjs"],
  ["entitlements", "verify-entitlements.mjs"],
  ["configuration center", "verify-configuration-center.mjs"],
  ["offers", "verify-offers.mjs"],
  ["products", "verify-products.mjs"],
  ["templates", "verify-templates.mjs"],
  ["agent templates", "verify-agent-templates.mjs"],
  ["compliance vendors", "verify-compliance-vendors.mjs"],
  ["dial preflight", "verify-dial-preflight.mjs"],
  ["credits & limits", "verify-credits-limits.mjs"],
  ["kill switches", "verify-kill-switches.mjs"],
  ["system maintenance", "verify-system-maintenance.mjs"],
  ["payment provider", "verify-payment-provider.mjs"],
  ["whop webhook", "verify-whop-webhook.mjs"],
  ["invoices", "verify-invoices.mjs"],
  ["custom invoices", "verify-custom-invoices.mjs"],
  ["credit notes", "verify-credit-notes.mjs"],
  ["coupons", "verify-coupons.mjs"],
  ["subscription events", "verify-subscription-events.mjs"],
  ["SA-2.7 subscription idempotency", "verify-subscription-idempotency.mjs"],
  ["period billing", "verify-period-billing.mjs"],
  ["LA-0 RLS", "verify-la0-rls.mjs"],
  // These four carry almost all of the LA-0 acceptance evidence and were missing from this list
  // until 2026-09-11. That omission is why the LA-0.1–LA-0.6 audit could only mark six tasks
  // PARTIAL: the proof existed and nothing ran it. Exactly the failure the header warns about.
  ["LA-0.1 agent shell", "verify-agent-shell.mjs"],
  ["LA-0.4 carrier library", "verify-carrier-library.mjs"],
  ["LA-0.5 appointment vault", "verify-appointment-vault.mjs"],
  ["LA-0.6 contacts & dedupe", "verify-contacts.mjs"],
  ["LA-1.1 partners", "verify-partners.mjs"],
  ["LA-1.2 partner users", "verify-partner-users.mjs"],
  ["LA-1.3 partner products", "verify-partner-products.mjs"],
  ["LA-1.4 dynamic forms and intake", "verify-dynamic-forms.mjs"],
  // Carries LA-1.4 acceptance criterion 5, the CSV export round-trip. verify-la1.mjs ran it; this
  // file never did, so a full verify:all reported green without it.
  ["LA-1.4 lead CSV import/export", "verify-lead-import.mjs"],
  ["LA-1.6 partner submission", "verify-partner-submission.mjs"],
  ["LA-1.7 intake pipeline", "verify-intake-pipeline.mjs"],
  ["LA-1.8 affiliate links", "verify-affiliate-links.mjs"],
  ["LA-1.5 TCPA/DNC screening", "verify-screening.mjs"],
  ["LA-1.9 pipelines", "verify-pipelines.mjs"],
  ["LA-1.10 transfer inbox", "verify-transfer-inbox.mjs"],
  ["LA-1.11 verification", "verify-verification.mjs"],
  ["LA-1.12 dispositions", "verify-dispositions.mjs"],
  ["LA-1.13 daily deal flow", "verify-deal-flow.mjs"],
  ["LA-1.14 buffer handoff", "verify-buffer-handoff.mjs"],
  ["LA-1.15 agent floor", "verify-agent-floor.mjs"],
  ["LA-1.16 partner chat", "verify-partner-chat.mjs"],
  ["LA-1.17 partner pipeline", "verify-partner-lead-pipeline.mjs"],
  ["LA-1.18 partner quality", "verify-partner-quality.mjs"],
  ["LA-1.19 subscription limits", "verify-subscription-limits.mjs"],
  ["LA-1.20 lead workspace", "verify-lead-workspace.mjs"],
  ["LA-1.21 lead notes", "verify-lead-notes.mjs"],
  ["LA-1.22 callbacks", "verify-callbacks.mjs"],
  ["LA-1.23 unclaimed SLA", "verify-unclaimed-sla.mjs"],
  ["LA-1.24 existing-customer preflight", "verify-existing-customer-preflight.mjs"],
  ["LA-1.25 agent alerts", "verify-agent-alerts.mjs"],
  ["LA-1 database security", "verify-la1-database-security.mjs"],

  // Wired 2026-09-12. These fifteen existed on disk and no runner referenced them -- not this file,
  // not verify-la1.mjs. Thirteen of the fifteen failed on the first run, which is the point: the
  // suites were written, the proof was never produced, and nothing said so. This is the same
  // omission recorded above for the four LA-0 suites, at larger scale and mostly across the SA
  // plane -- signup, checkout, trials, subscriptions, invoicing and roles.
  ["SA-1 user integrity", "verify-user-integrity.mjs"],
  ["SA-1 user token redemption", "verify-user-token-redemption.mjs"],
  ["SA-2 plan version integrity", "verify-plan-version-integrity.mjs"],
  ["SA-2.6 add-on meters", "verify-addon-meters.mjs"],
  ["SA-2.7 subscription transitions", "verify-subscription-transitions.mjs"],
  ["SA-2.8 tenant control-plane matrix", "verify-sa2-tenant-matrix.mjs"],
  ["SA-3 webhook invoicing", "verify-webhook-invoicing.mjs"],
  ["SA-3.2 annual invoice reconciliation", "verify-annual-invoice.mjs"],
  ["SA-3 manual settlement", "verify-manual-settlement.mjs"],
  ["SA-4.2 membership lookup", "verify-membership-lookup.mjs"],
  ["SA-5.1 self-serve signup", "verify-self-serve-signup.mjs"],
  ["SA-5.1 rate limits", "verify-rate-limits.mjs"],
  ["SA-5.2 checkout", "verify-checkout.mjs"],
  ["SA-5.3 trials", "verify-trials.mjs"],
  ["SA-5.4 legal documents", "verify-legal.mjs"],
  // Registered after the LA-2 audit found it on disk and run by nothing — which is the exact
  // failure mode the orphan check below exists to catch, and it caught it: `verify:all` refused to
  // start and named this file. It is an ordinary endpoint verifier (a nonexistent email and a
  // reserved documentation IP; it never authenticates, sends mail, or touches a real account), so
  // it belongs in the list rather than in NEVER_RUN_HERE.
  ["SA-6.2 login lockout", "verify-sa6-2.mjs"],
  // Runs early for the same reason the RPC contract does: it names the live schema gap that is
  // usually the explanation for whatever fails further down. It is red until the seven pending LA-2
  // migrations are applied, and that is the point — a green local suite over a stale database is
  // exactly what the 2026-09-18 audit found.
  ["LA-2 deployment gate", "verify-la2-deployment.mjs"],
  ["LA-0.2 tenant roles", "verify-tenant-roles.mjs"],
];

// verify-payment-provider.mjs imports TypeScript directly, so it needs the type-stripping flag the
// others do not. Passing it to every script would work but would print an experimental warning
// twenty times, which buries the actual output.
// The list above is a contract, so enforce it rather than trusting the comment. A suite that exists
// on disk and is referenced by nobody produces no evidence and reports no failure, which is how
// nineteen suites went unrun on this project across two separate occasions. Checked before anything
// runs, because the answer changes what a green run means.
const NEVER_RUN_HERE = new Set([
  // Needs two running servers rather than a database connection; separate CI step, separate script.
  "verify-kill-switches-multi.mjs",
  // Module runners, not suites. They spawn the same files this list does, so running them here
  // would execute every LA suite twice and double every failure in the summary.
  "verify-la0.mjs",
  "verify-la1.mjs",
]);
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const onDisk = readdirSync(scriptsDir).filter((name) => /^verify-.*.mjs$/.test(name) && name !== "verify-all.mjs");
const listed = new Set(SUITES.map(([, file]) => file));
const unlisted = onDisk.filter((name) => !listed.has(name) && !NEVER_RUN_HERE.has(name));
if (unlisted.length) {
  process.stdout.write(`[31m${unlisted.length} verification suite(s) exist on disk and are run by nothing:[0m
`);
  for (const name of unlisted) process.stdout.write(`  · ${name}
`);
  process.stdout.write(`
Add each to SUITES in this file, or to NEVER_RUN_HERE with a reason.
`);
  process.exit(255);
}
// Ask the filesystem, not the verify-* scan above. `onDisk` deliberately lists only verify-*.mjs
// because that is what the orphan check needs; using it here made every check-*.mjs entry look
// missing, which is why this line used to carry a hard-coded exemption for check-feature-keys.mjs.
// That exemption was a per-file patch for a whole-category mistake: the moment two more check-*
// suites were listed, verify:all refused to start and named files that were sitting right there.
const missingFile = SUITES.filter(([, file]) => !existsSync(join(scriptsDir, file)));
if (missingFile.length) {
  process.stdout.write(`[31mListed but absent from disk: ${missingFile.map(([, file]) => file).join(", ")}[0m
`);
  process.exit(255);
}

const NEEDS_TYPE_STRIPPING = new Set([
  "verify-payment-provider.mjs",
  "verify-period-billing.mjs",
  "verify-membership-lookup.mjs",
  "verify-trials.mjs",
]);

function run(file) {
  const flags = ["--env-file=.env.local"];
  if (NEEDS_TYPE_STRIPPING.has(file)) flags.unshift("--experimental-strip-types");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...flags, `scripts/${file}`], { stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

const failed = [];
const started = Date.now();

for (const [name, file] of SUITES) {
  process.stdout.write(`\n\u001b[1m── ${name}\u001b[0m (${file})\n`);
  const code = await run(file);
  if (code !== 0) failed.push(name);
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
process.stdout.write(`\n${"═".repeat(60)}\n`);
if (failed.length === 0) {
  process.stdout.write(`\u001b[32mAll ${SUITES.length} suites passed\u001b[0m in ${seconds}s\n`);
  process.exit(0);
}
process.stdout.write(`\u001b[31m${failed.length} of ${SUITES.length} suites failed\u001b[0m in ${seconds}s\n`);
for (const name of failed) process.stdout.write(`  · ${name}\n`);
process.exit(Math.min(failed.length, 255));
