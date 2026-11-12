// Retention QA pass 2026-11-05 (docs/qa/RETENTION-QA.md): what the hand test found, pinned so it stays fixed.
// Run with: node --experimental-strip-types --test lib/retention/qaPass.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PLATFORM_DEFAULT_SETTINGS as SETTINGS } from "./constants.ts";
import { buildQueue } from "./queue.ts";
import { newestOpenPerPolicy } from "./reinstatement.ts";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const card = (over = {}) => ({ key: "c|1", score: 80, band: "critical", confidence: "high", status: "active", daysPastDue: 0, boardReason: null, lastAttempt: null, hold: null, atRiskCents: 40000, nextDraftDays: 5, monthsSinceIssue: 2, ...over });

test("reinstatement: a policy whose lapse date moved shows one open case, the newest lapse", () => {
  const cases = [
    { id: "old", carrier_id: "A", policy_number: "P1", lapsed_on: "2026-12-24", status: "identified" },
    { id: "new", carrier_id: "A", policy_number: "P1", lapsed_on: "2026-12-28", status: "identified" },
    { id: "done", carrier_id: "A", policy_number: "P1", lapsed_on: "2026-10-01", status: "expired" },
    { id: "other", carrier_id: "B", policy_number: "P1", lapsed_on: "2026-12-01", status: "contacted" },
  ];
  assert.deepEqual(newestOpenPerPolicy(cases).map((c) => c.id), ["new", "done", "other"], "closed history is kept; another carrier's same number is its own policy");
  // The page list and the save queue's pinned count both read through it.
  const store = read("lib/retention/reinstatementStore.ts");
  assert.match(store, /cases = newestOpenPerPolicy\(c\)/);
  assert.match(store, /let rows = newestOpenPerPolicy\(/);
});

test("save queue: the Critical tile counts the queue, not every scored policy", () => {
  const settings = { ...SETTINGS, maxCards: 1 };
  const q = buildQueue([
    card({ key: "a", score: 90 }),
    card({ key: "b", score: 85 }),
    card({ key: "c", score: 60, band: "high" }),
    card({ key: "late", daysPastDue: 4 }), // past due: Lapse risk's, never the queue's
  ], settings, "2026-11-05");
  assert.equal(q.cards.length, 1, "only maxCards are drawn");
  assert.equal(q.total, 3);
  assert.equal(q.critical, 2, "counted over the whole queue, before the cap, without the past-due one");
  const board = read("components/app/save-queue-board.tsx");
  assert.match(board, /label="Critical" href=\{hrefWith\(\{ band: "critical" \}\)\} value=\{stats\.queueCritical/);
  assert.match(board, /across the book/);
});

test("reinstatement dialog: an amount nobody quoted starts empty, never $0", () => {
  // The case's fields moved from the pop-up to its page (2026-11-05): components/app/retention/reinstatement-case.tsx.
  const board = read("components/app/retention/reinstatement-case.tsx");
  assert.doesNotMatch(board, /owedCents \?\? 0\) \/ 100/);
  assert.match(board, /owedCents === null \? "" :/);
});

test("dialogs name the client as the rows do (carrier files send CAPS)", () => {
  // The case is a page now: its title is the client's name (app/app/(shell)/reinstatement/[id]/page.tsx).
  assert.match(read("app/app/(shell)/reinstatement/[id]/page.tsx"), /const name = row\.clientName \? personName\(row\.clientName\)/);
  // Round 7, owner pick 3·A, 2026-11-10: Mark handled moved off the row onto the claim's page, named as the rows are.
  assert.match(read("app/app/(shell)/reinstatement/claim/[id]/page.tsx"), /const claimName = \(c: ClaimRow\) => \(c\.clientName \? clientName\(/);
  assert.match(read("components/app/retention/winback-stages.tsx"), /export const clientName = \(r: [^)]*\) => \(r\.clientName \? personName\(r\.clientName\)/);
  // A request is a page now (2026-11-05): its title is the client's name.
  assert.match(read("app/app/(shell)/servicing/[id]/page.tsx"), /const name = r\.clientName \? personName\(r\.clientName\)/);
  // The request form moved onto the page (2026-11-05): components/app/retention/servicing-request-form.tsx.
  assert.match(read("components/app/retention/servicing-request-form.tsx"), / for \$\{personName\(prefill\.clientName\)\}/);
});

test("servicing: 'they said it was done on' defaults to the local day, not the UTC one", () => {
  // The step's fields moved onto the request page (2026-11-05).
  const view = read("components/app/retention/servicing-request-view.tsx");
  assert.doesNotMatch(view, /setConfirmedOn\] = useState\(new Date\(\)\.toISOString\(\)/);
  assert.match(view, /setConfirmedOn\] = useState\(\(\) => localDay\(\)\)/);
  assert.match(read("components/app/retention/servicing-shared.ts"), /d\.getFullYear\(\)/);
});

test("paper bill: its list is Cases › Paperwork now (critique E1), so the old address opens that tab", () => {
  assert.match(read("app/app/(shell)/servicing/page.tsx"), /if \(view === "campaign"\) redirect\("\/app\/retention\?step=paperwork&reason=mailed_bill"\);/);
});

test("save queue money is rounded to whole dollars, not cut", () => {
  const board = read("components/app/save-queue-board.tsx");
  assert.match(board, /Math\.round\(Math\.abs\(cents\) \/ 100\)/);
});
