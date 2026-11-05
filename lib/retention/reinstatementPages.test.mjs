// Reinstatement RiA and Win-back WbA (2026-11-05): a case is a page, not a pop-up; win-back claims are a view.
// Run with: node --test lib/retention/reinstatementPages.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const BOARD = "components/app/reinstatement-board.tsx";
const PAGE = "app/app/(shell)/reinstatement/[id]/page.tsx";
const CASE = "components/app/retention/reinstatement-case.tsx";
const WINBACK = "components/app/winback-board.tsx";

test("case list: no CaseDialog, the client and the row button open the case page", () => {
  const board = read(BOARD);
  assert.doesNotMatch(board, /CaseDialog/);
  assert.doesNotMatch(board, /@\/components\/ui\/dialog/);
  assert.match(board, /href=\{`\/app\/reinstatement\/\$\{r\.id\}`\}/);
  assert.match(board, /"Work the case" : "Update"\}<\/Link>/);
  assert.match(board, /params\.get\("cases"\) === "closed"/, "Open/Closed follows the address");
  assert.match(board, /href="\/app\/reinstatement\?cases=closed" label="Last 90 days"/);
});

test("case page: RetentionPage step=reinstatement behind the list page's gates", () => {
  const page = read(PAGE);
  assert.match(page, /guardPage\("winback"\)/);
  assert.match(page, /actAsPage\(guard, \["owner", "producer", "retention"\]\)/);
  assert.match(page, /<RetentionPage\s+step="reinstatement"/);
  assert.match(page, /retentionTrail\("reinstatement", name\)/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /params: Promise<\{ id: string \}>/);
  assert.match(page, /actions=\{locked \? undefined : <CaseActions/, "a closed or read-only case has no actions");
  assert.match(page, /personName\(row\.clientName\)/);
  for (const label of ["Reinstate or sell new", "What the carrier needs", "Notes"]) assert.match(page, new RegExp(`label: "${label}"`));
});

test("case page: the owed field starts empty when nothing was quoted, never $0", () => {
  const form = read(CASE);
  assert.match(form, /owedCents === null \? "" :/);
  assert.doesNotMatch(form, /owedCents \?\? 0\) \/ 100/);
  assert.match(form, /placeholder=\{c\.owedIsEstimate && c\.owedCents !== null \? `about \$\{money\(c\.owedCents\)\}`/);
});

test("case page: a decline goes through a confirm that asks why", () => {
  const form = read(CASE);
  assert.match(form, /<ConfirmDialog/);
  assert.match(form, /cancelLabel="Keep it open"/);
  assert.match(form, /confirmLabel="Mark declined"/);
  assert.match(form, /reason\.trim\(\)\.length >= 3/);
  assert.match(form, /confirmDisabled=\{!ready\}/);
  assert.match(form, /decline_reason: reason\.trim\(\)/);
  assert.doesNotMatch(form, /<Dialog[\s>]/, "no pop-up beyond the confirm");
});

test("win-back: possible claims are a view chip, not a second TableCard", () => {
  const board = read(WINBACK);
  assert.equal((board.match(/<TableCard/g) ?? []).length, 1);
  assert.doesNotMatch(board, /title="Possible claims"/);
  assert.match(board, /countTone="danger".*>Possible claims<\/ToggleChip>/);
  assert.match(board, /Mark handled: \{claim\.clientName \? personName\(claim\.clientName\)/);
  assert.match(board, /<StatTile href=\{winbackViewHref\("waiting"\)\}/);
  assert.match(read("app/app/(shell)/reinstatement/page.tsx"), />Open the Win-back list</);
});
