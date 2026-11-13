// Reinstatement RiA and Win-back WbA (2026-11-05): a case is a page, not a pop-up; win-back claims are a view.
// Run with: node --test lib/retention/reinstatementPages.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const BOARD = "components/app/reinstatement-board.tsx";
const PAGE = "app/app/(shell)/reinstatement/[id]/page.tsx";
const CASE = "components/app/retention/reinstatement-case.tsx";
const WINBACK = "components/app/winback-board.tsx";

// The old reinstatement case list (components/app/reinstatement-board.tsx) went in round 7: Win-back is the
// list (3·A, 2026-11-10) and a case still opens its own page. The board file is deleted, not left orphaned.
test("case list: the old reinstatement board is gone; Win-back is the list", () => {
  assert.equal(existsSync(join(process.cwd(), BOARD)), false);
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

// Round 7, owner pick 3·A, 2026-11-10: the stage cards became title-line tabs (each a link to its view, with its
// count), the two notices became counts, and Mark handled left the row for the claim's own page (a dialog there).
test("win-back: possible claims are a tab, not a second TableCard; a claim opens its page", () => {
  const board = read(WINBACK);
  const page = read("app/app/(shell)/reinstatement/page.tsx");
  const stages = read("components/app/retention/winback-stages.tsx");
  assert.equal((board.match(/<TableCard/g) ?? []).length, 1);
  assert.doesNotMatch(board, /title="Possible claims"/);
  assert.doesNotMatch(board, /<Callout|<RiskCards|<Button/, "no notices, no stage cards, no buttons in rows");
  assert.match(stages, /\{ key: "claims", label: "Possible claims" \}/);
  assert.match(page, /<ViewTabs/);
  assert.match(page, /href: winbackViewHref\(key\)/, "each tab is a link to its view");
  assert.match(page, /key === "claims" \? \{ tone: "danger" as const \}/, "Possible claims counts in red");
  assert.match(page, /"Scrub the list first" : "Open the Win-back list"/);
  assert.match(board, /const href = winbackClaimHref\(c\.id\);/);
  assert.match(read("components/app/retention/winback-claim-actions.tsx"), /action: "resolve_claim"/);
});
