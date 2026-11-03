// Run with: npm test
//
// LA-1.8 acceptance criterion 5: "No code path in LA-1.7 is duplicated for this."
//
// The ticket puts it as an instruction rather than a criterion, which is why it is worth a test:
//
//   "One intake pipeline, not three. This task adds an entry point and a shorter form definition.
//    It does not add a second lead model, a second work item, or a second disposition path. If you
//    find yourself copying LA-1.7, stop."
//
// Duplication here is not a tidiness problem. LA-1.7's whole design is that steps ③–⑤ are
// best-effort in the response but never in the record — each failure writes a durable
// `intake_failure` row and raises an alert, and a reconciliation job reports any lead with no work
// item. A second copy of that pipeline is a second place for those guarantees to be forgotten, and
// the symptom is the one LA-1.7 exists to prevent: "a paid live transfer disappears".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const API = join(ROOT, "app", "api");

function routes(dir = API, prefix = "") {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const id = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...routes(join(dir, entry.name), id));
    else if (entry.name === "route.ts") found.push(id);
  }
  return found.sort();
}

const read = (id) => readFileSync(join(API, id), "utf8");

/** The rows step ③–⑤ of LA-1.7 create. Only the shared writer may create them. */
const INTAKE_ARTIFACT_TABLES = ["lead_queue", "deal_flow", "lead_notifications"];

test("no API route creates intake artifacts itself", () => {
  const offenders = [];
  for (const id of routes()) {
    const source = read(id);
    for (const table of INTAKE_ARTIFACT_TABLES) {
      // An insert into one of these from a route is a second copy of steps ③–⑤.
      const pattern = new RegExp(`from\\(\\s*['"\`]${table}['"\`]\\s*\\)[\\s\\S]{0,200}?\\.insert\\s*\\(`);
      if (pattern.test(source)) offenders.push(`${id}: inserts ${table}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `route(s) writing LA-1.7 intake artifacts directly instead of calling ` +
      `writePartnerIntakeArtifacts:\n  ${offenders.join("\n  ")}`,
  );
});

test("both intake entry points share one writer", () => {
  // The portal (LA-1.6) and the affiliate link (LA-1.8) are two doors onto one pipeline. If either
  // stops calling the shared writer it has grown its own, which is the thing the ticket forbids.
  const entryPoints = ["partner/leads/route.ts", "affiliate/[slug]/route.ts"];

  const missing = entryPoints.filter(
    (id) => !existsSync(join(API, id)) || !/writePartnerIntakeArtifacts\s*\(/.test(read(id)),
  );

  assert.deepEqual(
    missing,
    [],
    `intake entry point(s) no longer calling writePartnerIntakeArtifacts:\n  ${missing.join("\n  ")}`,
  );
});

test("the shared writer is the only thing that calls it, from those two doors", () => {
  // Fails in the other direction: a third caller is a third entry point, and whoever adds one should
  // say so here rather than inheriting the guarantees by accident. Adding a door is fine — adding it
  // silently is not.
  const callers = routes().filter((id) => /writePartnerIntakeArtifacts\s*\(/.test(read(id)));

  assert.deepEqual(
    callers.sort(),
    ["affiliate/[slug]/route.ts", "partner/leads/route.ts"],
    "the set of intake entry points changed. Confirm the new one inherits LA-1.7's durable-failure " +
      "and reconciliation behaviour, then update this list",
  );
});
