// Commissions boards 12–14 (2026-11-03): the Ledger's columns and More, Pay issues as groups, Producer pay's columns.
// Run with: node --experimental-strip-types --test lib/commissions/commissionsBoards.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { disputeRecord, groupPayIssues, orderLetters, payIssueGroupHref, payIssueGroupPrimary, payIssueHref, payIssueNeighbours, PAY_ISSUE_NEXT, PAY_ISSUE_USUALLY } from "./payIssueGroups.ts";
import { DISCREPANCY_TYPES } from "../ingestion/discrepancyEngine.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const issue = (over) => ({ type: "missing", carrierId: "c1", carrierName: "Aflac", owedToYouCents: 0, owedToCarrierCents: 0, unpriced: false, foundAt: "2026-09-12T00:00:00Z", ...over });

test("round 7 2·A: pay issues group by carrier and kind, two money columns never netted, each group with its own page", () => {
  const groups = groupPayIssues([
    issue({ type: "mis_rated", carrierId: "c1", carrierName: "American Amicable", owedToCarrierCents: 5000 }),
    issue({ type: "mis_rated", carrierId: "c1", carrierName: "American Amicable", owedToYouCents: 4410, foundAt: "2026-08-01T00:00:00Z" }),
    issue({ type: "short_paid", carrierId: "c2", carrierName: "Aetna", owedToYouCents: 2118 }),
    issue({ type: "missing", carrierId: null, carrierName: "Unknown Life", unpriced: true }),
  ]);
  assert.deepEqual(groups.map((g) => [g.type, g.carrierName, g.count, g.owedToYouCents, g.owedToCarrierCents]), [["mis_rated", "American Amicable", 2, 4410, 5000], ["short_paid", "Aetna", 1, 2118, 0], ["missing", "Unknown Life", 1, 0, 0]]);
  assert.equal(groups[0].oldest, "2026-08-01T00:00:00Z");
  assert.equal(groups[0].href, "/app/discrepancies/group?carrier=c1&kind=mis_rated");
  assert.equal(groups[2].href, "/app/discrepancies/group?carrier=name%3Aunknown+life&kind=missing", "a carrier Insurvas does not know is named in the address");
  assert.equal(groups[2].next, "Add the rate first", "unpriced missing commission says to add the rate");
  assert.equal(payIssueGroupHref("c2", "short_paid", "closed"), "/app/discrepancies/group?carrier=c2&kind=short_paid&tab=closed");
  for (const type of DISCREPANCY_TYPES) { assert.ok(PAY_ISSUE_USUALLY[type], `${type} has a "usually" hint`); assert.ok(PAY_ISSUE_NEXT[type], `${type} has a next step`); }
});

test("round 7 2·1–2·4: the group's primary by kind, issue and letter addresses, ‹ › neighbours, the dispute record", () => {
  assert.equal(payIssueGroupPrimary("missing", 0), "letter");
  assert.equal(payIssueGroupPrimary("missing", 581), "add_rate");
  assert.equal(payIssueGroupPrimary("mis_rated", 0), "fix_rate");
  assert.equal(payIssueGroupPrimary("over_paid", 0), null, "a held kind has no primary");
  assert.equal(payIssueHref({ id: "a", source: "carrier" }), "/app/discrepancies/a");
  assert.equal(payIssueHref({ id: "b", source: "hand" }, "lines"), "/app/discrepancies/b?source=hand&tab=lines");
  const { previous, next } = payIssueNeighbours(["x", "y", "z"], (v) => v === "x");
  assert.equal(previous, null);
  assert.equal(next, "y");
  const letters = orderLetters([{ id: "2", carrierName: "B", createdAt: "2026-11-01" }, { id: "1", carrierName: "A", createdAt: "2026-10-01" }, { id: "3", carrierName: "A", createdAt: "2026-11-03" }]);
  assert.deepEqual(letters.map((l) => l.id), ["3", "1", "2"]);
  const record = disputeRecord([
    { carrierId: "c", carrierName: "American Home Life", status: "partial", totalCents: 51850, outcomeCents: 12960 },
    { carrierId: "c", carrierName: "American Home Life", status: "accepted", totalCents: 75696, outcomeCents: 40138 },
    { carrierId: "c", carrierName: "American Home Life", status: "sent", totalCents: 999, outcomeCents: null },
  ]);
  assert.deepEqual(record, [{ carrierId: "c", name: "American Home Life", settled: 2, won: 2, claimedCents: 127546, creditedCents: 53098 }]);
});

test("round 7 2·A: Open · Letters out · Settled · Closed, Check now and Work the largest; no notices, no row buttons", () => {
  const page = read("app/app/(shell)/discrepancies/page.tsx");
  assert.match(page, /label: "Open"[^]*label: "Letters out"[^]*label: "Settled"[^]*label: "Closed"/);
  assert.match(page, /<CheckNowButton readOnly=\{readOnly\} \/>/);
  assert.match(page, />Work the largest<\/Link>/);
  assert.doesNotMatch(page, /Callout|PageAlert/, "warnings are counts on chips, never notices");
  const list = read("components/app/commissions/pay-issues/pay-issues-list.tsx");
  assert.match(list, />By carrier and kind<\/ToggleChip>/);
  assert.match(list, />One by one<\/ToggleChip>/);
  assert.match(list, />Not checked<\/ToggleChip>/);
  assert.match(list, />Imported by hand<\/ToggleChip>/);
  assert.match(list, /You appear to be owed/);
  assert.doesNotMatch(list, /<Button\b|type="checkbox"|Callout/, "no buttons, ticks or notices in the rows");
  for (const file of ["components/app/commissions/pay-issues/decide-dialog.tsx", "components/app/commissions/pay-issues/letter-dialog.tsx", "components/app/commissions/pay-issues/letter-actions.tsx"]) assert.doesNotMatch(read(file), /Callout|PageAlert/, file);
  const decide = read("components/app/commissions/pay-issues/decide-dialog.tsx");
  for (const choice of ["Put it on a letter to", "The rate is wrong", "It was paid outside the statement", "Write it off", "Dismiss", "Open again", "Save and open"]) assert.ok(decide.includes(choice), choice);
  assert.match(read("components/app/commissions/pay-issues/letter-dialog.tsx"), /action: "draft_dispute", ids: ticked/);
  const letter = read("components/app/commissions/pay-issues/letter-actions.tsx");
  for (const action of ["Mark sent", "Record the outcome", "Mark acknowledged", "Download PDF"]) assert.ok(letter.includes(action), action);
});

test("board 12: no always-empty column, Client and Agent when known, the file and row in the Statement cell, More holds Export", () => {
  const ledger = read("components/app/carrier-ledger.tsx");
  for (const column of ["anyPayee", "anyClient", "anyAgent"]) assert.match(ledger, new RegExp(`\\{${column} && <th`), `${column} gates its column`);
  assert.doesNotMatch(ledger, /<th[^>]*>Source<\/th>/, "the source folds into the Statement cell");
  assert.doesNotMatch(ledger, /<th[^>]*>Carrier<\/th>/, "the carrier sits in the Statement cell");
  assert.match(ledger, /<MoreMenu items=\{\[\.\.\.more, \{ label: "Export CSV"/);
  assert.match(ledger, /onClick=\{\(\) => router\.push\(lineHref\(row\)\)\}/, "the whole row opens its line");
  const page = read("app/app/(shell)/ledger/page.tsx");
  assert.match(page, /<StepSlotTarget id=\{LEDGER_SLOT\} \/>/);
  assert.match(page, /label: "Carrier accounts", href: "\/app\/ledger\?view=accounts"/);
  assert.match(read("components/app/statement-import.tsx"), /Import a statement/);
});

test("round 7 4·A: Pay {Month} is the one primary, the view and the month are in the address, rows have no buttons", () => {
  const page = read("app/app/(shell)/producer-reconciliation/page.tsx");
  assert.match(page, /<Link href=\{`\/app\/producer-payouts\?period=\$\{period\}`\}>\{payLabel\}<\/Link>/);
  assert.match(page, /const payLabel = `Pay \$\{monthName\(period\)\}`;/);
  assert.doesNotMatch(page, /Run payouts/);
  assert.match(page, /<ParamSelect label="Month" param="period"/);
  assert.match(page, /key: "review", label: "To review"/);
  const board = read("components/app/agency/reconciliation-board.tsx");
  // One-line tables (owner 2026-11-11): Advanced left the list for the status chip; it stays on the producer's Money tab.
  assert.match(board, /Earned<\/TableHead>[^]*Charged back<\/TableHead>[^]*Paid out<\/TableHead>[^]*Owed at month end/);
  assert.match(board, /onClick=\{openRow\(record\)\}/, "the whole row opens the producer");
  assert.doesNotMatch(board, /<Segmented\b/, "no switches in memory: the views are the page's tabs");
  assert.doesNotMatch(read("lib/commissions/producerPayFigures.ts"), /agency_ledger_sync|\.insert\(|\.update\(|\.delete\(/, "the figures only read");
});
