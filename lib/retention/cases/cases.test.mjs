// The Retention ladder's pages, routes and scorecard (owner 2026-11-05, pick A; docs/retention/SPEC.md).
// Run with: node --experimental-strip-types --test lib/retention/cases/cases.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { caseScorecard, rateText, MIN_DECIDED } from "./scorecard.ts";
import { STEP_SLUG, stepFromSlug } from "./ladder.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");

test("scorecard: saved is the files' word, closed-without-a-save stays out of the rate, counts under 10 decided", () => {
  const c = (ownerId, step, status, extra = {}) => ({ ownerId, step, status, unreachable: false, monthlyCents: 5000, ...extra });
  const card = caseScorecard([
    c("a", "pending_lapse", "saved"), c("a", "pending_lapse", "lost"), c("a", "payment_problem", "closed_no_save"),
    c("a", "payment_problem", "open", { unreachable: true }), c(null, "paperwork", "working"),
  ]);
  const a = card.people.find((p) => p.key === "a");
  assert.deepEqual([a.open, a.saved, a.lost, a.closedNoSave, a.unreachable, a.keptCents], [1, 1, 1, 1, 1, 5000]);
  assert.equal(a.rate, null);
  assert.equal(rateText(a), "1 of 2 saved");
  assert.equal(card.steps.find((s) => s.key === "pending_lapse").saved, 1);
  assert.ok(card.people.some((p) => p.key === "nobody"));
  const many = caseScorecard(Array.from({ length: MIN_DECIDED }, (_, i) => c("b", "payment_problem", i < 7 ? "saved" : "lost")));
  assert.equal(rateText(many.total), "70%");
});

test("the step lives in the address both ways", () => {
  for (const [step, slug] of Object.entries(STEP_SLUG)) assert.equal(stepFromSlug(slug), step);
  assert.equal(stepFromSlug("nope"), null);
});

test("the ladder pages: list → case page → tabs, under the module's gate; no side panels, pop-ups only to confirm", () => {
  const list = read("app/app/(shell)/retention/page.tsx");
  assert.match(list, /guardPage\("chargeback_radar"\)/);
  assert.match(list, /<RetentionPage step="cases"/);
  assert.match(list, /ensureCasesFresh\(/, "grace running out moves cases without a file");
  const page = read("app/app/(shell)/retention/[id]/page.tsx");
  assert.match(page, /\{ key: "do", label: "What to do"/);
  assert.match(page, /\{ key: "history", label: "History"/);
  assert.match(page, /aria-label="Where it is on the ladder"/);
  const view = read("components/app/retention/case-view.tsx");
  assert.doesNotMatch(view, /DetailPanel|Sheet\b/);
  assert.equal((view.match(/<Dialog open/g) ?? []).length, 2, "only Close without a save and Assign are pop-ups");
  assert.match(view, /variant="destructive"[\s\S]*Close without a save/);
  const board = read("components/app/retention/ladder-board.tsx");
  assert.match(board, /<FilterPopover /);
  assert.doesNotMatch(board, /<StatStrip/, "the steps are the risk cards (round 3), not a tile strip");
});

test("the UI pass (2026-11-05): a Closed tab, a New case page, no repeated reason, no duplicate primary", () => {
  const list = read("app/app/(shell)/retention/page.tsx");
  assert.match(list, /href="\/app\/retention\/new">New case</);
  const board = read("components/app/retention/ladder-board.tsx");
  assert.match(board, /function ClosedTable/);
  assert.match(board, /key: "closed", label: "Closed"/, "Closed is a card beside the ladder (round 3)");
  assert.match(board, /\{ key: "none", label: "No carrier window"/, "no carrier window is its own group");
  const fresh = read("app/app/(shell)/retention/new/page.tsx");
  assert.match(fresh, /guardPage\("chargeback_radar"\)/);
  assert.match(fresh, /access === "read_only"/);
  assert.match(read("components/app/retention/new-case.tsx"), /action: "open", carrier_id: picked\.carrierId/);
  assert.match(read("components/app/retention/ladder-mark.tsx"), /reason === "lapsed_reinstatable" \|\| reason === "chargeback" \? null/);
  assert.match(read("components/app/retention/case-view.tsx"), /onDoTab \? null :/);
  assert.match(read("lib/reports/views.ts"), /key: "retentionResults"[^\n]*offRail: true/);
  assert.match(read("components/app/reports/reports-rail.tsx"), /!item\.offRail/);
});

test("critique A1–A4 (2026-11-05): signed countdowns, a confirmed close to win-back, lists that agree, no '$0 revives'", () => {
  const sync = read("lib/retention/cases/sync.ts");
  assert.match(sync, /daysLeft: b\?\.daysLeftSigned \?\? null/, "the ladder gets the signed countdown, not the board's clamped one");
  assert.match(read("lib/ingestion/retentionStore.ts"), /signedDaysLeftFor\(input, reason, today\)/);
  const view = read("components/app/retention/case-view.tsx");
  assert.match(view, /onClick=\{\(\) => setLosing\(true\)\}>Close to win-back</, "never one click");
  assert.match(view, /title="Close to win-back\?"/);
  assert.match(view, /!afterLapse && typeof row\.evidence\.days_past_due/);
  const store = read("lib/retention/reinstatementStore.ts");
  assert.match(store, /BACK_IN_FORCE\.has\(p\.status_normalized\)/);
  assert.match(store, /inForceNow: inForceNow\.length/);
  assert.match(read("components/app/retention/reinstatement-case.tsx"), /row\.chargeback && !c\.reinstate\.advanceRevivesCents/);
});

test("critique B–E (2026-11-05): one place to work, plain words, the carrier's codes out of the way", () => {
  const board = read("components/app/retention/ladder-board.tsx");
  assert.match(read("app/app/(shell)/retention/page.tsx"), /\{ key: "mine", label: "Mine"/, "B6: Mine is a title-line tab (round 3)");
  assert.match(board, /variant=\{isUrgent\(r\) \? "default" : "outline"\}/, "B2: one filled button only where it is urgent");
  assert.match(board, /No phone on file/, "B4");
  assert.match(board, /cents2\(r\.monthlyCents\)/, "B7");
  assert.match(board, /then win-back/, "B8");
  const mark = read("components/app/retention/ladder-mark.tsx");
  assert.match(mark, /approved_unpaid: "issued, never paid"/, "B5");
  assert.doesNotMatch(read("lib/retention/cases/ladder.ts"), /"Call: first payment"|"Close · to win-back"/, "B3");
  const view = read("components/app/retention/case-view.tsx");
  assert.match(view, /No phone on file: find a number/, "C2");
  assert.match(view, /Record the payment/, "C3");
  assert.match(view, /initialNote=\{note\}/, "C4: the note is not lost");
  assert.match(read("components/app/retention/servicing-request-form.tsx"), /const \[sendNow, setSendNow\] = useState\(false\)/, "C4: never recorded as sent before it was");
  assert.match(view, /<ReinstatementActions row=\{r\} \/>/, "D1: step 3 works the reinstatement in place");
  assert.match(read("lib/retention/cases/store.ts"), /updateCase\(viewer, r\.id, \{ status: "contacted" \}\)/, "D1: one tracker");
  assert.match(read("app/app/(shell)/reinstatement/[id]/page.tsx"), /redirect\(`\/app\/retention\/\$\{ladderCase\}`\)/, "D3");
  assert.match(read("app/app/(shell)/servicing/page.tsx"), /redirect\("\/app\/retention\?step=paperwork&reason=mailed_bill"\)/, "E1");
  assert.match(read("components/app/servicing-board.tsx"), /The file doesn't show it/, "E2: plain words");
  assert.match(read("components/app/servicing-board.tsx"), /From a Retention case/, "E3");
  assert.match(read("lib/retention/steps.ts"), /label: "Win-back", href: "\/app\/reinstatement"/, "E4");
});

test("round 3 (owner 2026-11-06): header A + table B on the three lists; nothing opens inside a table", () => {
  for (const file of ["components/app/retention/ladder-board.tsx", "components/app/servicing-board.tsx", "components/app/winback-board.tsx"]) {
    const src = read(file);
    assert.match(src, /<RiskCards /, `${file}: the risk cards on top`);
    assert.doesNotMatch(src, /<FilterPanel\b/, `${file}: filters never push the table down`);
    assert.doesNotMatch(src, /colSpan=\{\d+\}[^\n]*(What to do|Log the call)/, `${file}: no row opens in place`);
  }
  const board = read("components/app/retention/ladder-board.tsx");
  assert.match(board, /<ActiveFilters inline /, "applied filters are chips on the toolbar line");
  assert.match(board, /<HoverPeek trigger=/, "a read-only peek on the name");
  assert.match(board, /const groupOf = /, "grouped by urgency");
  assert.match(read("components/ui/data-toolbar.tsx"), /export function FilterPopover\b/);
  assert.match(read("components/app/retention/risk-cards.tsx"), /tag: string/);
  assert.match(read("lib/retention/cases/store.ts"), /advanceAtRisk\(viewer\.tenantId/, "the advance at stake on the row");
  assert.match(read("app/app/(shell)/reinstatement/winback/[id]/page.tsx"), /guardPage\("winback"\)/, "a Win-back client has a page");
  assert.match(read("components/app/winback-board.tsx"), /href=\{`\/app\/reinstatement\/winback\/\$\{r\.id\}`\}/);
});

test("the case page (owner 2026-11-06): steps that follow on, a progress bar, no chips by the name, dictated notes", () => {
  const view = read("components/app/retention/case-view.tsx");
  assert.match(view, /sequential: true/, "steps that follow on, one after another");
  assert.match(view, /sequential: false/, "a list where order doesn't matter (lost, a checklist)");
  assert.match(view, /<NoteField /, "dictate inside the note box");
  assert.doesNotMatch(view, /<DictateButton /, "no separate Dictate button beside the box");
  assert.match(read("components/ui/note-field.tsx"), /<DictateButton compact/, "the mic sits inside the box");
  assert.match(view, /action: "note", id: row\.id/, "a note saves on its own");
  assert.match(view, /<FactTable rows=\{facts\} \/>/, "the files' facts are a table");
  const page = read("app/app/(shell)/retention/[id]/page.tsx");
  assert.doesNotMatch(page, /chip=\{/, "the step and the deadline are the progress bar, not chips by the name");
  assert.match(page, /aria-label=\{at \? `Stage: \$\{STEP_LABELS\[row\.step\]\}`/, "only the stage the case is at");
  assert.doesNotMatch(page, /LADDER_STEPS/, "never the stages it isn't at");
  assert.match(read("app/api/app/retention/cases/route.ts"), /z\.literal\("note"\)/);
  assert.match(read("components/ui/dictate-button.tsx"), /useSyncExternalStore/);
});

test("only the files open, move and save; a person only logs, fixes, assigns and closes without a save", () => {
  const store = read("lib/retention/cases/store.ts");
  assert.doesNotMatch(store, /status: "saved"/, "a person never marks a case saved");
  assert.match(store, /if \(input\.as === "lost" && row\.step !== "lost"\) throw/);
  assert.match(store, /\.eq\("status", row\.status\)\.select\("id"\)/, "a file that moved the case meanwhile wins");
  const sync = read("lib/retention/cases/sync.ts");
  assert.match(sync, /status: "saved", resolved_at: now, resolved_by: "file"/);
  assert.match(read("lib/ingestion/stages.ts"), /const retentionLadder: ReprocessStage/);
  const route = read("app/api/app/retention/cases/route.ts");
  assert.match(route, /requireFeatureRole\("chargeback_radar", \["owner", "producer", "retention"\] as const, \{ write: true \}\)/);
  assert.doesNotMatch(route, /z\.literal\("save"\)/);
  assert.match(read("app/api/app/retention/ladder-rules/route.ts"), /requireFeatureRole\("chargeback_radar", \["owner"\] as const/);
});

test("Lapse risk hands over to Cases only once the tables exist (a head request hid the missing table)", () => {
  const store = read("lib/retention/cases/store.ts");
  const fn = store.slice(store.indexOf("export async function ladderAvailable"), store.indexOf("/** A premium as a monthly figure"));
  assert.doesNotMatch(fn, /head: true/);
  assert.match(fn, /return !error;/);
  assert.match(read("app/app/(shell)/lapse-risk/page.tsx"), /if \(await ladderAvailable\(guard\.context\.tenantId\)\) redirect\("\/app\/retention"\);/);
});

test("the migration: one open ladder case per policy, append-only timeline, no tenant writes, no clash with LA-6.6", () => {
  const sql = read("supabase/migrations/20261105200000_retention_ladder_cases.sql");
  assert.match(sql, /create unique index if not exists retention_case_open_ladder on public\.retention_case \(tenant_id, carrier_id, policy_number\)\s+where step <> 'paperwork'/);
  assert.match(sql, /revoke update, delete, truncate on public\.retention_case_event from service_role/);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.retention_case, public\.retention_case_event, public\.retention_ladder_rule from tenant_app/);
  assert.doesNotMatch(sql, /public\.retention_rule\b/, "LA-6.6 owns retention_rule (data retention)");
  assert.doesNotMatch(sql, /^\s*(begin|commit);/m);
});
