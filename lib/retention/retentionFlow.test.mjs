// Retention, one page (owner 2026-11-02): Module 5's working pages out of the Book group into an area of their
// own, each still at its own address and under its own gate; its two reports in Reports; Lapse risk in Book of
// business, Carrier appointments in Compliance, the Rate card in Book of business › Setup.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { RETENTION_STEPS, retentionStepOf } from "./steps.ts";
import { AGENT_MENU } from "../menu/definition.ts";
import { buildSidebarTree } from "../menu/sidebar.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

test("every Retention address is a step, and renders inside the frame under its own gate", () => {
  // 2026-11-05: Cases (the ladder from the carrier files) leads; the predictive Save queue left the rail but still answers.
  // Round 7 (owner pick 0·A, 2026-11-10): one rail, work then measure.
  assert.deepEqual(RETENTION_STEPS.map((step) => step.key), ["cases", "servicing", "reinstatement", "scorecard", "results"]);
  const pages = { retention: "cases", "save-queue": "save", servicing: "servicing", reinstatement: "reinstatement" };
  for (const [route, step] of Object.entries(pages)) {
    assert.equal(retentionStepOf(`/app/${route}`), step, route);
    const page = read(`app/app/(shell)/${route}/page.tsx`);
    assert.match(page, new RegExp(`<RetentionPage step="${step}"`), route);
    assert.match(page, /guardPage\(/, `${route} keeps its own gate`);
    assert.doesNotMatch(page, /<PageHeader\b/, `${route}: the frame draws the one title`);
  }
  assert.equal(retentionStepOf("/app/lapse-risk"), null, "Lapse risk is Book of business, never beside a prediction");
  // The scorecard and Results left Reports for the Retention rail (round 7, owner pick 0·A/5·A/6·A, 2026-11-10);
  // each keeps its own gate, and Reports keeps two rows that open them at the same addresses.
  for (const [route, step] of [["retention-scorecard", "scorecard"], ["retention-results", "results"]]) {
    assert.equal(retentionStepOf(`/app/${route}`), step, route);
    const page = read(`app/app/(shell)/${route}/page.tsx`);
    assert.match(page, new RegExp(`<RetentionPage step="${step}"`), route);
    assert.doesNotMatch(page, /<ReportsPage\b/, `${route} is not a Reports view any more`);
    assert.match(page, /guardPage\("chargeback_radar"\)/, `${route} keeps its own gate`);
  }
  assert.match(read("lib/reports/views.ts"), /key: "retention",[^\n]*href: "\/app\/retention-scorecard"[^\n]*elsewhere: true/);
  assert.match(read("lib/reports/views.ts"), /key: "retentionResults",[^\n]*href: "\/app\/retention-results"[^\n]*elsewhere: true/);
});

test("the sidebar shows one Retention link, and the moved pages sit where they belong", () => {
  const retention = AGENT_MENU.find((entry) => entry.id === "retention");
  assert.equal(retention.label, "Retention");
  assert.ok(retention.items.every((entry) => entry.groupLink), "one link, no dropdown");
  const tree = buildSidebarTree([retention]);
  assert.deepEqual(tree.groups.find((g) => g.label === "Retention").items.map((i) => i.key), ["retention.save-queue"]);
  assert.equal(AGENT_MENU.find((entry) => entry.id === "book"), undefined, "no Book group");
  const sectionOf = (key) => AGENT_MENU.find((entry) => entry.items.some((i) => i.key === key))?.label;
  // A Needs you view, so Carrier sync's since 2026-11-05 (Needs you left Book of business).
  assert.equal(sectionOf("retention.lapse-risk"), "Carrier sync");
  assert.equal(sectionOf("book.appointments"), "Compliance");
  assert.equal(sectionOf("book.rate_card"), "Book of business");
  assert.match(read("app/app/(shell)/lapse-risk/page.tsx"), /<DataInPage step="needs-you" title="Lapse risk"/);
  assert.match(read("app/app/(shell)/appointments/page.tsx"), /<ComplianceFlowPage step="appointments">/);
  assert.match(read("components/app/agent-sidebar.tsx"), /retentionStepOf\(href\) && retentionStepOf\(pathname\)/);
});
