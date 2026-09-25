// Run with: npm test
//
// LA-1.21 criteria 2 and 3:
//
//   "A partner user cannot see internal notes through any route — verified by test, including the
//    export."
//   "Changing a note from shared to internal removes it from the partner's view."
//
// `scripts/verify-lead-notes.mjs` proves both against three routes — chat, lead detail, CSV export —
// and names its reasoning. Three is enough here, and it is worth writing down *why*, because "any
// route" normally needs an exhaustive check (see `lib/partnerAuth/planeIsolation.test.mjs`):
//
//   A note reaches the partner plane through exactly ONE carrier. A shared note is posted into the
//   partner's channel as a `partner_messages` row with `event_key = "lead-note:<id>"`. Nothing else
//   crosses. `PartnerLeadRow` — what the list, the pipeline and the CSV export all serialise — has
//   no note field at all, so those routes cannot leak one whatever they do.
//
// So the surface is two readers of one carrier: the chat and the lead detail. Both re-resolve the
// note's CURRENT visibility at read time rather than trusting the message, which is what makes
// criterion 3 work retroactively — flipping a note to internal hides it without deleting the message
// that carried it.
//
// ## What this file guards
//
// Those two readers implement that rule **separately**, in `lib/partnerChat/service.ts` and
// `lib/partnerLeads/service.ts`. Identical predicates, two copies. Today they agree. If one gains a
// third visibility value, or drops the `deleted_at` half, a note hidden on one surface stays visible
// on the other — and the ticket is explicit that this is the failure that matters: "A note written in
// a hurry must never surprise its author by appearing in a partner's channel."
//
// A source scan rather than an import, because both modules are `server-only`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const READERS = ["lib/partnerChat/service.ts", "lib/partnerLeads/service.ts"];

const read = (path) =>
  readFileSync(join(ROOT, path), "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

test("both partner-facing readers filter notes on the same predicate", () => {
  const predicates = [];
  for (const path of READERS) {
    if (!existsSync(join(ROOT, path))) continue;
    const source = read(path);
    // The shape both use: keep a note only when it is currently shared and not deleted.
    const shared = /visibility\s*===\s*["'`]shared["'`]/.test(source);
    const notDeleted = /!\s*\w+\.deleted_at/.test(source);
    predicates.push(`${path}: shared=${shared} notDeleted=${notDeleted}`);
  }

  assert.ok(predicates.length === READERS.length, "a partner note reader has moved or been renamed");
  assert.deepEqual(
    [...new Set(predicates.map((entry) => entry.split(": ")[1]))],
    ["shared=true notDeleted=true"],
    `the two partner note readers disagree about what a partner may see:\n  ${predicates.join("\n  ")}`,
  );
});

test("both readers resolve visibility at read time, not from the message", () => {
  // The carrier is a `partner_messages` row. If a reader trusted that row instead of looking the
  // note up again, criterion 3 would stop working: the message was shared when it was written, and
  // that is exactly the state the criterion says must be revocable.
  const offenders = [];
  for (const path of READERS) {
    if (!existsSync(join(ROOT, path))) continue;
    const source = read(path);
    const looksUpNote = /from\(\s*["'`]tenant_lead_notes["'`]\s*\)/.test(source);
    const usesEventKey = /lead-note:/.test(source);
    if (!looksUpNote || !usesEventKey) offenders.push(`${path}: looksUpNote=${looksUpNote} usesEventKey=${usesEventKey}`);
  }

  assert.deepEqual(
    offenders,
    [],
    `partner note reader(s) not re-resolving the note's current visibility:\n  ${offenders.join("\n  ")}`,
  );
});

test("the partner lead row carries no note field for the bulk routes to leak", () => {
  // The list, the pipeline and the CSV export all serialise `PartnerLeadRow`. The export is the one
  // the criterion names, and the reason it is dangerous is that it writes rows in bulk rather than
  // assembling a view — a field that was never meant to travel goes out with everything else.
  // Keeping notes off the row type means none of those three can leak one by construction.
  const types = read("lib/partnerLeads/types.ts");
  const row = /export type PartnerLeadRow = \{([\s\S]*?)\n\};/.exec(types);

  assert.ok(row, "PartnerLeadRow has moved — re-check what the partner list and export serialise");
  assert.ok(
    !/\bnote\b|\bnotes\b/i.test(row[1]),
    `PartnerLeadRow gained a note field. The CSV export and the pipeline serialise this type, and ` +
      `neither filters by note visibility:\n${row[1].trim()}`,
  );
});
