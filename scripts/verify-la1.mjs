/** Run every LA-1 ticket verifier without hiding later failures behind the first broken suite. */
import { spawn } from "node:child_process";
import process from "node:process";

const SUITES = [
  ["LA-1.1 partners", "verify-partners.mjs"],
  ["LA-1.2 partner users", "verify-partner-users.mjs"],
  ["LA-1.3 partner products", "verify-partner-products.mjs"],
  ["LA-1.4 dynamic forms", "verify-dynamic-forms.mjs"],
  ["LA-1.5 TCPA/DNC screening", "verify-screening.mjs"],
  ["LA-1.6 partner submission", "verify-partner-submission.mjs"],
  ["LA-1.7 intake pipeline", "verify-intake-pipeline.mjs"],
  ["LA-1.8 affiliate links", "verify-affiliate-links.mjs"],
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
];

const SUITE_TIMEOUT_MS = 15 * 60 * 1000;

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--env-file=.env.local", `scripts/${file}`], { stdio: ["inherit", "pipe", "pipe"] });
    let output = "";
    const capture = (chunk, target) => { const text = chunk.toString(); target.write(text); output = `${output}${text}`.slice(-100_000); };
    child.stdout.on("data", (chunk) => capture(chunk, process.stdout));
    child.stderr.on("data", (chunk) => capture(chunk, process.stderr));
    const timer = setTimeout(() => { child.kill(); }, SUITE_TIMEOUT_MS);
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code: code ?? 1, output, timedOut: signal != null }); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: 1, output: `${output}\n${error.message}`, timedOut: false }); });
  });
}

const failed = [];
const started = Date.now();
for (const [name, file] of SUITES) {
  process.stdout.write(`\n\u001b[1m-- ${name}\u001b[0m (${file})\n`);
  let result = await run(file);
  if (result.code !== 0) {
    process.stdout.write(`\n\u001b[33mRetrying ${name} once after a failed run${result.timedOut ? " (suite timeout)" : ""}.\u001b[0m\n`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    result = await run(file);
  }
  if (result.code !== 0) failed.push(name);
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
process.stdout.write(`\n${"=".repeat(60)}\n`);
if (failed.length === 0) {
  process.stdout.write(`\u001b[32mAll ${SUITES.length} LA-1 suites passed\u001b[0m in ${seconds}s\n`);
  process.exit(0);
}
process.stdout.write(`\u001b[31m${failed.length} of ${SUITES.length} LA-1 suites failed\u001b[0m in ${seconds}s\n`);
for (const name of failed) process.stdout.write(`  - ${name}\n`);
process.exit(Math.min(failed.length, 255));
