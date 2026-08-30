/**
 * Runs every database-backed verification suite in one pass.
 *
 * Twenty suites exist and each one was previously run by hand, which meant "all of them pass" was a
 * claim nobody could check cheaply — and it was wrong at least once this project, when ten of the
 * twenty-one had simply never been run. This runs the lot and, crucially, does NOT stop at the
 * first failure: one broken suite must not hide the state of the other nineteen.
 *
 * verify:switches:multi is deliberately absent. It needs two running servers rather than a database
 * connection, so it is a separate CI step and a separate npm script.
 *
 * Exit code is the number of failed suites, capped at 255, so CI fails and a human reading the log
 * sees the count without scrolling.
 */
import { spawn } from "node:child_process";
import process from "node:process";

const SUITES = [
  ["tenant isolation", "verify-tenant-isolation.mjs"],
  ["feature keys", "check-feature-keys.mjs"],
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
];

// verify-payment-provider.mjs imports TypeScript directly, so it needs the type-stripping flag the
// others do not. Passing it to every script would work but would print an experimental warning
// twenty times, which buries the actual output.
const NEEDS_TYPE_STRIPPING = new Set(["verify-payment-provider.mjs"]);

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
