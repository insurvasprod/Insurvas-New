// Reports foundation pass (2026-11-03, docs/reports/FOUNDATION-PASS.md): the owner's rules for every
// Reports view, held in the source so a later change cannot quietly undo them.
// Run with: node --experimental-strip-types --test lib/reports/foundationPass.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const VIEWS = {
  sales: "components/app/applications/sales-performance.tsx",
  activity: "components/app/activity-log-workspace.tsx",
  scoring: "components/app/scoring-workspace.tsx",
  book: "components/app/book-scorecards.tsx",
  cpa: "components/app/true-cpa-workspace.tsx",
  partner: "components/app/partner-quality-workspace.tsx",
  partnerDetail: "components/app/partner-quality-detail.tsx",
  // The retention scorecard and results left Reports for the Retention rail (round 7, owner pick 0·A/5·A/6·A,
  // 2026-11-10); their rules are pinned in lib/retention/retentionFlow.test.mjs and lib/retention/cases/results.test.mjs.
};
const DETAILS = {
  agent: "components/app/activity-agent-detail.tsx",
  cpaLeads: "components/app/true-cpa-leads.tsx",
  partnerLeads: "components/app/partner-quality-leads.tsx",
};
const ROUTES = ["sales-performance", "activity", "scoring", "book-scorecards", "true-cpa", "partner-quality"].map((r) => `app/app/(shell)/${r}/page.tsx`);
const NEW_ROUTES = ["activity/agent/[agentId]", "true-cpa/leads", "partner-quality/[partnerId]/leads"].map((r) => `app/app/(shell)/${r}/page.tsx`);
const ALL = [...Object.values(VIEWS), ...Object.values(DETAILS), "components/app/partner-quality-parts.tsx", "components/app/reports/reports-rail.tsx"];

test("every view's tabs sit on the title line, never as a row in the step", () => {
  // Partner quality is one table: it has no views of its own.
  for (const [key, file] of Object.entries(VIEWS).filter(([k]) => k !== "partner")) {
    const source = read(file);
    assert.match(source, /<(InReportsSlot framed=\{framed\}|ReportsSlot) slot="lead">\s*\n?\s*<ViewTabs/, `${key}: its ViewTabs go into the frame's lead slot`);
  }
  for (const file of Object.values(DETAILS).filter((f) => !f.includes("leads"))) assert.match(read(file), /<ReportsSlot slot="lead"><ViewTabs/, file);
});

test("a client view's tab is in the address, so a tile, a link or a reload lands on it", () => {
  for (const key of ["sales", "activity", "scoring", "cpa", "partnerDetail"]) assert.match(read(VIEWS[key]), /useUrlTab\(/, key);
  assert.match(read(DETAILS.agent), /useUrlTab\(/);
  // On a partner record the detail is embedded under ?tab=quality, so its own sections use another key.
  assert.match(read(VIEWS.partnerDetail), /useUrlTab\(DETAIL_TABS, "leads", "section"\)/);
  // Book scorecards is a server view: its tabs are links.
  assert.match(read(VIEWS.book), /tabs=\{BOOK_TABS\.map\(\(t\) => \(\{ key: t\.key, label: t\.label, href: viewHref\(t\.key\) \}\)\)\}/);
  assert.match(read("app/app/(shell)/book-scorecards/page.tsx"), /const VIEWS = \["book", "persistency", "chargebacks", "weeks", "scorecards", "today"\] as const;/);
});

test("figures are one strip whose tiles are the links", () => {
  for (const key of ["sales", "activity", "cpa", "partnerDetail"]) {
    const strip = read(VIEWS[key]).match(/<StatStrip[\s\S]*?<\/StatStrip>/)?.[0] ?? "";
    assert.ok(strip, `${key}: has a strip`);
    assert.match(strip, /href=\{/, `${key}: its tiles link`);
    assert.doesNotMatch(strip, /action=\{<RowsLink|action=\{<button/, `${key}: no "Rows" button under a figure`);
  }
  assert.match(read(VIEWS.book), /function BookStrip\([\s\S]*?href=\{viewHref\("persistency"\)\}[\s\S]*?href=\{viewHref\("chargebacks"\)\}/);
  assert.doesNotMatch(read(VIEWS.cpa), /function RowsLink/);
});

test("no side panels or sheets: an agent, a figure's leads and a drill are pages", () => {
  for (const file of ALL) assert.doesNotMatch(code(read(file)), /<DetailPanel\b|<Sheet\b|createPortal\(|role="dialog"/, file);
  for (const route of NEW_ROUTES) assert.ok(existsSync(join(process.cwd(), route)), route);
  assert.match(read(VIEWS.activity), /href=\{agentHref\(row\.agent_user_id\)\}/, "an agent row opens the agent's page");
  assert.match(read(VIEWS.cpa), /href=\{drillHref\(totalDrill\("issued"\)\)\}/, "a True CPA figure opens its leads page");
  assert.match(read("lib/reports/trueCpaLeads.ts"), /export const TRUE_CPA_LEADS_PATH = "\/app\/true-cpa\/leads";/);
  assert.match(read("components/app/partner-quality-parts.tsx"), /router\.push\(drilldownHref\(next\)\)/, "a partner figure opens its leads page");
  // A record's header: its title and one muted line of facts, set on the frame.
  for (const file of Object.values(DETAILS)) assert.match(read(file), /useReportsTitle\([^)]+,\s*[^)]+\)/, file);
  assert.match(read("components/app/reports/reports-slot.tsx"), /meta=\{shownFacts \? <p className="mt-1 text-sm text-muted-foreground/);
});

test("one list at a time: no view stacks two tables or holds two side by side", () => {
  // The stacked cards this pass split into tabs.
  assert.doesNotMatch(read(VIEWS.sales), /secondary/, "Requirements is its own tab");
  assert.match(read(VIEWS.sales), /\{ key: "requirements", label: "Requirements" \}/);
  assert.doesNotMatch(read(VIEWS.cpa), /xl:grid-cols-2/, "the curves, speed and consent are tabs");
  assert.doesNotMatch(read(VIEWS.partnerDetail), /lg:grid-cols-2/, "Outcomes and Screening are tabs");
  assert.doesNotMatch(read(VIEWS.scoring), /<section aria-label="How the score is divided"/, "the weights are a tab with a table");
  assert.doesNotMatch(read(VIEWS.book), /function Overview\(/, "Overview's five cards are tabs");
  assert.doesNotMatch(read(VIEWS.activity), /\{tab === "review" && reviewsZeroClick && <AppointmentCloseOutStrip \/>\}/, "close-outs are their own tab");
});

test("no notice on the page: errors and states go to the bell, explainers are the title's (i)", () => {
  for (const file of ALL) {
    const source = code(read(file));
    assert.doesNotMatch(source, /<p[^>]*role="(alert|note|status)"/, `${file}: a hand-made notice line`);
    assert.doesNotMatch(source, /rounded-(md|lg)[^"]*bg-\[var\(--(warning|error|success|info)-surface\)\]|bg-\[var\(--(warning|error|success|info)-surface\)\][^"]*rounded/, `${file}: a tinted notice box`);
    assert.doesNotMatch(source, /<NextStepLine\b/, `${file}: a "Next step" strip`);
    assert.doesNotMatch(source, /SampleDataNotice/, file);
  }
  for (const route of ROUTES) assert.match(read(route), /<ReportsPage view="[a-zA-Z]+"[^>]* info=/, `${route}: its explainer is the (i)`);
  assert.doesNotMatch(read("components/app/reports/reports-rail.tsx"), /Period kept as you switch/, "no info card at the rail's foot");
});

test("lists come from TableCard with no hand-made height, filters open in the panel", () => {
  for (const file of ALL) assert.doesNotMatch(read(file), /min-h-\[calc\(100dvh/, `${file}: TableCard fills to the foot by itself (§6b)`);
  for (const key of ["sales", "activity", "cpa"]) {
    const source = read(VIEWS[key]);
    assert.match(source, /<FilterButton /, key);
    assert.match(source, /<FilterPanel id=/, key);
    assert.match(source, /<ActiveFilters /, key);
  }
  // The period first in the toolbar: the one Reports period control where the window is free.
  for (const key of ["sales", "cpa"]) assert.match(read(VIEWS[key]), /<PeriodPicker /, key);
  assert.match(read("components/app/partner-quality-parts.tsx"), /<PeriodPicker /);
  // A framed view's first read draws no second header.
  for (const key of ["activity", "scoring", "cpa", "partner", "partnerDetail"]) assert.match(read(VIEWS[key]), /framed \? <FramedLoading \/> : <PageLoading \/>/, key);
});

test("pop-ups only confirm: the sample size is a confirm with its field, not a toolbar form", () => {
  const book = read(VIEWS.book);
  assert.match(book, /<ConfirmDialog[\s\S]*?title="Sample size"[\s\S]*?fields=\{/);
  assert.match(book, /<MoreMenu items=\{\[\{ label: "Sample size"/);
  for (const file of ALL) assert.doesNotMatch(read(file), /<DialogContent\b/, file);
});
