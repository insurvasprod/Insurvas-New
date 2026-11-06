// The owner's pick of 2026-11-05 (docs/retention/CRITIQUE.md): the save queue opens a card's page ("SqA"),
// the paper-bill campaign a call page ("PbA"); Retention results answers first ("ReA"); the scorecard opens on
// everyone ("ScA"). Plain rules plus source checks.
// Run with: node --experimental-strip-types --test lib/retention/savePages.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { actionsFor, defaultActionFor, isUnreached } from "./callLog.ts";
import { retentionStepOf } from "./steps.ts";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("a logged call can't be refused and agreed at once: what you did follows what happened", () => {
  const suggested = ["convert_to_draft", "confirm_account"];
  assert.deepEqual(actionsFor("reached_refused", suggested), ["none", "review_coverage", "courtesy_call"]);
  assert.ok(!actionsFor("reached_refused", suggested).includes("convert_to_draft"));
  assert.equal(actionsFor("reached_agreed", suggested)[0], "convert_to_draft", "the card's own fix comes first");
  assert.ok(!actionsFor("reached_agreed", suggested).includes("none"), "agreed means something was agreed");
  assert.deepEqual(actionsFor("already_fixed", suggested), ["confirm_account", "none", "confirm_card_funded"]);
  for (const o of ["voicemail", "no_answer", "wrong_number"]) {
    assert.equal(isUnreached(o), true);
    assert.deepEqual(actionsFor(o, suggested), ["none"]);
  }
  assert.equal(defaultActionFor("reached_agreed", suggested), "convert_to_draft");
  assert.equal(defaultActionFor("", suggested), "none");
});

test("a card's page, a request and a case belong to their step (the sidebar and the rail stay on it)", () => {
  assert.equal(retentionStepOf("/app/save-queue/5bd2ff41-fd83-485e-9373-9ada7a0aa3c7/0119915458"), "save");
  assert.equal(retentionStepOf("/app/servicing/campaign/5bd2ff41-fd83-485e-9373-9ada7a0aa3c7/0119915458"), "servicing");
  assert.equal(retentionStepOf("/app/reinstatement/2f6d3b52-0f52-4c7e-9a2b-5a51c1a8b1a0"), "reinstatement");
  assert.equal(retentionStepOf("/app/save-queue-old"), null);
});

test("SqA · the queue's row starts the fix; the call, the fix and income live on the card's page", () => {
  const board = read("components/app/save-queue-board.tsx");
  assert.match(board, /<Link href=\{`\$\{href\}\?tab=fix&fix=\$\{firstType\}`\}>Start the fix<\/Link>/);
  assert.doesNotMatch(board, /function LogDialog|ServicingRequestDialog|<IncomeCapture/, "no pop-up forms or inline editors left on the list");
  assert.match(board, /<FilterButton /, "one Filters button (§6a)");
  for (const href of ["href={pathname}", "href={hrefWith({ band: \"critical\" })}", "href=\"/app/retention-settings\"", "href={hrefWith({ need: \"income\" })}"]) assert.ok(board.includes(href), `a tile links: ${href}`);
  const page = read("app/app/(shell)/save-queue/[carrierId]/[policyNumber]/page.tsx");
  assert.match(page, /guardPage\("chargeback_radar"\)/);
  assert.match(page, /actAsPage\(guard, \["owner", "producer", "retention"\]\)/);
  assert.match(page, /<RetentionPage\s+step="save"/);
  assert.match(page, /\{ key: "why", label: "Why"/);
  assert.match(page, /\{ key: "calls", label: "Calls"/);
  // A prediction stays drawn as one (Module 5, rule 1): dashed, and it says it is not the carrier's.
  assert.match(page, /border-dashed/);
  assert.match(page, /Not something the carrier reported/);
  const card = read("components/app/retention/save-card.tsx");
  assert.match(card, /<ServicingRequestForm /);
  assert.match(card, /actionsFor\(outcome, suggested\)/);
  // A snooze or dismissal is the one pop-up: a confirm with a reason.
  assert.match(card, /disabled=\{reason\.trim\(\)\.length < 3 \|\| busy\}/);
});

test("the card loader never refuses a card for being off the queue, only for being someone else's", () => {
  const store = read("lib/retention/queueStore.ts");
  const loader = store.slice(store.indexOf("export async function loadSaveCard"), store.indexOf("/** Log a worked card"));
  assert.match(loader, /viewer\.role === "retention" && !ownsCard\(/);
  assert.doesNotMatch(loader, /throw new SaveQueueError/);
  assert.match(loader, /isEmergency\(card\) \? "emergency"/);
});

test("PbA · one call, one answer; the talk track is edited in Settings only; results are a view, not a pop-up", () => {
  // The list itself folded into Cases › Paperwork (critique E1, 2026-11-05); its call pages still answer.
  assert.ok(!existsSync(join(process.cwd(), "components/app/paper-bill-campaign.tsx")));
  const call = read("components/app/retention/paper-bill-call.tsx");
  assert.match(call, /type="bill_to_draft_conversion" origin="campaign"/);
  assert.match(call, /confirmAction\(\{ title: "No bank account\?"/, "leaving the campaign for good asks first");
  assert.match(call, /Edited in Settings › Retention/);
  assert.ok(existsSync(join(process.cwd(), "app/app/(shell)/servicing/campaign/[carrierId]/[policyNumber]/page.tsx")));
});

test("ReA · Retention results answers its two questions first; ScA · the owner lands on everyone", () => {
  const results = read("components/app/retention/retention-results-board.tsx");
  assert.ok(results.indexOf('label="Do the bands come true?"') < results.indexOf('label="Predictions checked"'));
  assert.match(results, /label="Does working beat the holdout\?"/);
  assert.doesNotMatch(results, /footer=\{<span>\{VERDICT_TEXT\[accuracy\.verdict\]\}<\/span>\}/, "the verdict is the tile, not a line under the table");
  const scorecard = read("components/app/retention/retention-scorecard-board.tsx");
  assert.match(scorecard, /useUrlTab\(\["people", "reasons"\] as const, team \? \(selected \? "reasons" : "people"\) : "reasons"\)/);
  // The people list shows counts, never a blended save rate (LA-5.8).
  const people = scorecard.slice(scorecard.indexOf('{shown === "people" && (\n        <TableCard'));
  assert.doesNotMatch(people.slice(0, people.indexOf("</table>")), /rateText\(/);
});
