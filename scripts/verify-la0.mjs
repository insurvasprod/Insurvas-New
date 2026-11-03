import "./lib/refuseProduction.mjs";
/**
 * The whole LA-0 acceptance matrix in one command: `npm run verify:la0`.
 *
 * It exists because the six LA-0 tasks were audited as PARTIAL on 2026-09-10 while the proof for
 * most of their acceptance criteria was already written — four of these five suites were simply
 * absent from verify-all.mjs, so nothing ran them. One named command per module makes "is LA-0
 * green?" a question anyone can answer in one step, instead of five remembered script names.
 *
 * Like verify-all.mjs this does NOT stop at the first failure: one broken suite must not hide the
 * state of the others. Exit code is the number of failed suites.
 *
 * The unit-level half of the matrix lives in `npm test` (moneyRoutes, sessionSeparation,
 * planBranching, singleSource, tiles, checklist, resolve, eligibility). Run both.
 */
import { spawn } from "node:child_process";
import process from "node:process";

const SUITES = [
  ["LA-0.1 agent shell, login & entitlement menu", "verify-agent-shell.mjs"],
  ["LA-0.1 entitlement engine contract", "verify-entitlements.mjs"],
  ["LA-0.2/0.5/0.6 RLS and grants", "verify-la0-rls.mjs"],
  ["LA-0.4 carrier, product & commission library", "verify-carrier-library.mjs"],
  ["LA-0.5 appointment & contract vault", "verify-appointment-vault.mjs"],
  ["LA-0.6 contact, household & dedupe", "verify-contacts.mjs"],
];

// verify-appointment-vault.mjs imports lib/appointments/eligibility.ts directly.
const NEEDS_TYPE_STRIPPING = new Set(["verify-appointment-vault.mjs", "verify-contacts.mjs"]);

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
  process.stdout.write(`\n[1m── ${name}[0m (${file})\n`);
  const code = await run(file);
  if (code !== 0) failed.push(name);
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
process.stdout.write(`\n${"═".repeat(60)}\n`);
if (failed.length === 0) {
  process.stdout.write(`[32mAll ${SUITES.length} LA-0 suites passed[0m in ${seconds}s\n`);
  process.stdout.write("Now confirm the unit half: npm test\n");
  process.exit(0);
}
process.stdout.write(`[31m${failed.length} of ${SUITES.length} LA-0 suites failed[0m in ${seconds}s\n`);
for (const name of failed) process.stdout.write(`  · ${name}\n`);
process.stdout.write("\nIf every suite failed at fixture setup, check that a user can be created:\n");
process.stdout.write("supabase/migrations/20260911120000_auth_user_bridge_name_fix.sql may not be applied.\n");
process.exit(Math.min(failed.length, 255));
