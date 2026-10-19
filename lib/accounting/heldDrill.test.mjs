// Held commission is never money in (E2E 2026-10-16): the P&L puts it in its own section, and the
// drill behind a line must agree — no held line under "in", no other line under "held".
// Run with: node --test lib/accounting/heldDrill.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const store = readFileSync(join(process.cwd(), "lib/accounting/pnlStore.ts"), "utf8").replace(/\r\n/g, "\n");
const drill = store.slice(store.indexOf("export async function drill"));

test("a drill pairing held with money in, either way round, lists nothing", () => {
  assert.match(drill, /if \(\(d\.section === "in" && d\.entryType === "held"\) \|\| \(d\.section === "held" && d\.entryType !== "held" && d\.entryType !== "reversal"\)\) return \{ rows: \[\], more: false \};/);
});

test("a reversal is listed where what it reverses belongs", () => {
  assert.match(drill, /for \(const table of \["commission_entry", "commission_account_entry"\]\)/);
  assert.match(drill, /rows = rows\.filter\(\(r\) => \(corrects\.get\(r\.entryId\) === "held"\) === \(d\.section === "held"\)\);/);
});
