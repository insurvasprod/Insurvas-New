// Commissions boards 12–14 (2026-11-03): the Ledger's columns and More, Pay issues as groups, Producer pay's columns.
// Run with: node --experimental-strip-types --test lib/commissions/commissionsBoards.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { groupPayIssues, payIssueReviewHref, PAY_ISSUE_USUALLY } from "./payIssueGroups.ts";
import { DISCREPANCY_TYPES } from "../ingestion/discrepancyEngine.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

test("board 13: pay issues group by cause and carrier, the largest difference first, each with its Review page", () => {
  const groups = groupPayIssues([
    { type: "mis_rated", carrierId: "c1", carrierName: "American Amicable", differenceCents: -5000 },
    { type: "mis_rated", carrierId: "c1", carrierName: "American Amicable", differenceCents: -4410 },
    { type: "short_paid", carrierId: "c2", carrierName: "Aetna", differenceCents: 2118 },
    { type: "short_paid", carrierId: null, carrierName: "Unknown Life", differenceCents: 10 },
  ]);
  assert.deepEqual(groups.map((g) => [g.type, g.carrierName, g.count, g.differenceCents]), [["mis_rated", "American Amicable", 2, -9410], ["short_paid", "Aetna", 1, 2118], ["short_paid", "Unknown Life", 1, 10]]);
  assert.equal(groups[0].reviewHref, "/app/needs-you/review?kind=money&carrier=c1&type=mis_rated");
  assert.equal(groups[2].reviewHref, null, "a carrier Insurvas does not know has no Review page to open");
  assert.equal(payIssueReviewHref("c2", "short_paid"), "/app/needs-you/review?kind=money&carrier=c2&type=short_paid");
  for (const type of DISCREPANCY_TYPES) assert.ok(PAY_ISSUE_USUALLY[type], `${type} has a "usually" hint`);
});

test("board 13: Open · Letters out · Closed, Group alike, and every decision kept", () => {
  const page = read("app/app/(shell)/discrepancies/page.tsx");
  assert.match(page, /label: "Open"[^]*label: "Letters out"[^]*label: "Closed"/);
  const list = read("components/app/carrier-discrepancies.tsx");
  assert.match(list, />Group alike<\/ToggleChip>/);
  assert.match(list, /groupPayIssues\(visible\.map\(groupInput\)\)/);
  for (const action of ["Draft letter", "Dispute letter", "Mark disputed", "Check now", "Dismiss", "Open again", "Resolved", "Write off", "Reopen"]) assert.ok(list.includes(action), action);
  assert.match(list, /Review the largest/);
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

test("board 14: Run payouts is the one primary, and Pay leads with Earned, Advanced, Charged back and Owed", () => {
  const page = read("app/app/(shell)/producer-reconciliation/page.tsx");
  assert.match(page, /actions=\{<Button asChild type="button"><Link href="\/app\/producer-payouts">Run payouts<\/Link><\/Button>\}/);
  const board = read("components/app/agency/reconciliation-board.tsx");
  assert.match(board, /Earned<\/TableHead>[^]*Advanced<\/TableHead>[^]*Charged back<\/TableHead>[^]*Owed /);
  assert.match(board, /onClick=\{record \? \(\) => router\.push\(record\) : undefined\}/, "the whole row opens the producer");
  assert.doesNotMatch(read("lib/commissions/producerPayFigures.ts"), /agency_ledger_sync|\.insert\(|\.update\(|\.delete\(/, "the figures only read");
});
