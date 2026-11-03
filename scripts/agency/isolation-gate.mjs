// AG-0.5 · THE RELEASE GATE. Exits 1 while any route a narrow role can reach still reads producer-scoped data
// without the AG-0.4 helper. Nothing in AG-0.6 … AG-1.12 ships to an agency tenant until this exits 0 AND the
// live check (verify-producer-isolation.mjs) passes.
//
//   node scripts/agency/isolation-gate.mjs            the report
//   node scripts/agency/isolation-gate.mjs --baseline rewrite lib/agency/isolationBaseline.json (shrinking only)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { analyse } from "../../lib/agency/isolationAudit.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const results = analyse(root);
const holes = results.filter((r) => r.leaks.length);
const baselinePath = join(root, "lib/agency/isolationBaseline.json");

if (process.argv.includes("--baseline")) {
  const current = Object.fromEntries(holes.map((h) => [h.route, h.leaks.map((l) => l.module).sort()]));
  const previous = JSON.parse(readFileSync(baselinePath, "utf8"));
  for (const [route, modules] of Object.entries(current)) {
    const was = new Set(previous.holes?.[route] ?? []);
    const grew = modules.filter((m) => !was.has(m));
    if (previous.holes && grew.length) {
      console.error(`refusing to grow the baseline: ${route} now also leaks through ${grew.join(", ")}`);
      process.exit(1);
    }
  }
  writeFileSync(baselinePath, `${JSON.stringify({ note: "AG-0.5 known holes. May only shrink. Empty = gate passes.", holes: current }, null, 2)}\n`);
  console.log(`baseline written: ${holes.length} routes`);
  process.exit(0);
}

const narrow = results.filter((r) => r.narrow).length;
console.log(`AG-0.5 isolation gate — ${results.length} routes, ${narrow} reachable by producer/assistant/setter, ${holes.length} unscoped`);
const byModule = new Map();
for (const h of holes) for (const l of h.leaks) byModule.set(l.module, [...(byModule.get(l.module) ?? []), h.route]);
for (const [module, routes] of [...byModule].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(routes.length).padStart(3)}  ${module}`);
}
process.exit(holes.length ? 1 : 0);
