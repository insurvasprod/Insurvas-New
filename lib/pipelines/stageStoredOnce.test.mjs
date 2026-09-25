// Run with: npm test
//
// LA-1.9 acceptance criterion 5: "A lead's stage is stored once, as an id."
//
// The ticket lists this among three traps carried over from the current implementation:
//
//   "Stage is stored twice on every lead — once as text and once as a foreign key — and nothing
//    keeps them in sync after the insert. Store the id; derive the name."
//
// Measured on the live project, 2026-09-22:
//
//   lead_queue   11,543 rows · 11,538 comparable · 11,538 disagree with their stage_id
//   deal_flow        19 rows ·      19 comparable ·      19 disagree
//
// Every one of them says `stage_key = "new"`. One deal-flow row says "new" while its `stage_id`
// resolves to **Submitted**. The text copy is frozen at insert exactly as the ticket predicts.
//
// The criterion is nonetheless MET in behaviour, and that distinction is the whole point of this
// file: `stage_key` is written once (`lib/leadPost/service.ts`, hard-coded `"new"`) and **read by
// nothing**. The authoritative stage is `stage_id`, so no screen and no filter can show a stale
// stage. What remains is a loaded gun — a plausible-looking `select("… stage_key …")` on any of
// these tables returns "new" for every row in the database, forever, which is precisely how the
// original defect behaved.
//
// Dropping the column is the real fix and needs DDL this environment does not grant; the generated
// Insert type still requires it, so the write cannot simply stop either. Until then, this keeps the
// column inert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
const LEAD_TABLES = ["agent_leads", "lead_queue", "deal_flow"];

function sourceFiles(target) {
  const absolute = join(ROOT, target);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [target];
  const found = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (["node_modules", ".next"].includes(entry.name)) continue;
    const child = `${target}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sourceFiles(child));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) found.push(child);
  }
  return found;
}

const appSources = () =>
  ["lib", "app", "components"]
    .flatMap(sourceFiles)
    .filter((path) => path !== "lib/supabase/database.types.ts")
    .map((path) => [path, readFileSync(join(ROOT, path), "utf8")]);

test("nothing reads stage_key back off a lead table", () => {
  // The realistic way this comes back is someone adding it to a select list because the column is
  // there and looks meaningful.
  const offenders = [];
  for (const [path, source] of appSources()) {
    for (const table of LEAD_TABLES) {
      const pattern = new RegExp(
        `from\\(\\s*['"\`]${table}['"\`]\\s*\\)[\\s\\S]{0,400}?\\.select\\(\\s*['"\`][^'"\`]*\\bstage_key\\b`,
      );
      if (pattern.test(source)) offenders.push(`${path}: selects stage_key from ${table}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `stage_key is a frozen legacy copy — every row in the database says "new" regardless of its ` +
      `real stage. Read stage_id and resolve the name:\n  ${offenders.join("\n  ")}`,
  );
});

test("the stage a lead is on is written as an id", () => {
  // The positive half: intake must set `stage_id`. A lead with only the text copy would be the
  // defect in its original form.
  // Scoped to the insert's own payload, not the whole file. Checking the file merely for the string
  // `stage_id` is too weak: a comment mentioning it, or a helper that computes it and then forgets
  // to spread it in, would both satisfy that — which is exactly what the first version of this test
  // did, and a mutation removing the field from the payload passed it.
  const insertPayload = /from\(\s*['"`](?:agent_leads|lead_queue)['"`]\s*\)\s*\.insert\s*\(\s*(?:\[\s*)?\{(?<payload>[\s\S]{0,900}?)\n\s*\}/g;

  const missing = [];
  let inserts = 0;
  for (const [path, source] of appSources()) {
    for (const match of source.matchAll(insertPayload)) {
      inserts += 1;
      if (!/\bstage_id\b/.test(match.groups.payload)) missing.push(path);
    }
  }
  assert.ok(inserts > 0, "no lead inserts found — this test is checking nothing");

  assert.deepEqual(
    missing,
    [],
    `module(s) inserting a lead without a stage_id:\n  ${missing.join("\n  ")}`,
  );
});

test("only one module still writes the legacy text copy onto a lead table", () => {
  // Pinned so the column does not spread while it waits for a DDL drop. If this list grows,
  // something new is populating a field nothing reads.
  //
  // Scoped to modules that actually touch a lead table. `template_stages.stage_key` is a different
  // column and a legitimate concept — the product template's own stage vocabulary (SA-4.6) — and an
  // earlier version of this test failed on the two template editors that maintain it.
  const writers = appSources()
    .filter(([, source]) => LEAD_TABLES.some((table) => new RegExp(`from\\(\\s*['"\`]${table}['"\`]`).test(source)))
    .filter(([, source]) => /\bstage_key:\s*['"`]/.test(source))
    .map(([path]) => path)
    .sort();

  assert.deepEqual(
    writers,
    ["lib/leadPost/service.ts"],
    "the set of modules writing a literal stage_key changed. It is a legacy column that nothing " +
      "reads; do not add writers, and drop it when DDL allows",
  );
});
