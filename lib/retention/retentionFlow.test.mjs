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
  assert.deepEqual(RETENTION_STEPS.map((step) => step.key), ["save", "servicing", "reinstatement"]);
  const pages = { "save-queue": "save", servicing: "servicing", reinstatement: "reinstatement" };
  for (const [route, step] of Object.entries(pages)) {
    assert.equal(retentionStepOf(`/app/${route}`), step, route);
    const page = read(`app/app/(shell)/${route}/page.tsx`);
    assert.match(page, new RegExp(`<RetentionPage step="${step}"`), route);
    assert.match(page, /guardPage\(/, `${route} keeps its own gate`);
    assert.doesNotMatch(page, /<PageHeader\b/, `${route}: the frame draws the one title`);
  }
  assert.equal(retentionStepOf("/app/lapse-risk"), null, "Lapse risk is Book of business, never beside a prediction");
  // The scorecard and Retention results (was "Does it work?") are Reports views (owner 2026-11-02).
  assert.match(read("app/app/(shell)/retention-scorecard/page.tsx"), /<ReportsPage view="retention"[ >]/);
  assert.match(read("app/app/(shell)/retention-results/page.tsx"), /<ReportsPage view="retentionResults"[ >]/);
  assert.equal(retentionStepOf("/app/retention-results"), null);
});

test("the sidebar shows one Retention link, and the moved pages sit where they belong", () => {
  const retention = AGENT_MENU.find((entry) => entry.id === "retention");
  assert.equal(retention.label, "Retention");
  assert.ok(retention.items.every((entry) => entry.groupLink), "one link, no dropdown");
  const tree = buildSidebarTree([retention]);
  assert.deepEqual(tree.groups.find((g) => g.label === "Retention").items.map((i) => i.key), ["retention.save-queue"]);
  assert.equal(AGENT_MENU.find((entry) => entry.id === "book"), undefined, "no Book group");
  const sectionOf = (key) => AGENT_MENU.find((entry) => entry.items.some((i) => i.key === key))?.label;
  assert.equal(sectionOf("retention.lapse-risk"), "Book of business");
  assert.equal(sectionOf("book.appointments"), "Compliance");
  assert.equal(sectionOf("book.rate_card"), "Book of business");
  assert.match(read("app/app/(shell)/lapse-risk/page.tsx"), /<DataInPage step="needs-you" title="Lapse risk"/);
  assert.match(read("app/app/(shell)/appointments/page.tsx"), /<ComplianceFlowPage step="appointments">/);
  assert.match(read("components/app/agent-sidebar.tsx"), /retentionStepOf\(href\) && retentionStepOf\(pathname\)/);
});
