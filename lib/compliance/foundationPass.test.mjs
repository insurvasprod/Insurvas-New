// Compliance foundation pass (2026-11-03, docs/compliance/FOUNDATION-PASS.md): the rules the owner set for every
// merged page, held on the Compliance screens. Run with: node --experimental-strip-types --test lib/compliance/foundationPass.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { complianceStepOf } from "./steps.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const SCREENS = [
  "components/app/suppression-workspace.tsx",
  "components/app/tcpa-dnc-exemptions.tsx",
  "components/app/tcpa-screening-audit.tsx",
  "components/app/consent-locker-workspace.tsx",
  "components/app/compliance/complaints-board.tsx",
  "components/app/compliance/deletion-requests-board.tsx",
  "components/app/compliance/evidence-report.tsx",
  "components/app/carrier-appointments-page.tsx",
  "app/app/(shell)/compliance/page.tsx",
];
const RECORDS = [
  "app/app/(shell)/consent/[id]/page.tsx",
  "app/app/(shell)/complaints/[id]/page.tsx",
  "app/app/(shell)/complaints/new/page.tsx",
  "app/app/(shell)/deletion-requests/[id]/page.tsx",
  "app/app/(shell)/deletion-requests/new/page.tsx",
  "app/app/(shell)/tcpa/exemptions/new/page.tsx",
];

test("the frame is the shared StepFrame: one rail for every merged page, settings at its foot", () => {
  const frame = read("components/app/compliance/compliance-flow.tsx");
  assert.match(frame, /<StepFrame\b/);
  assert.match(frame, /foot: owner \? \{ label: "Compliance settings", href: "\/app\/compliance\/settings" \} : null/);
  assert.equal(existsSync(join(process.cwd(), "components/app/compliance/compliance-rail.tsx")), false, "the copy of the rail is gone");
  assert.match(read("components/app/step-frame/step-rail.tsx"), /foot\?: \{ label: string; href: string \} \| null;/);
  // A record's title, status chip and one facts line sit on the title line, as Accounting's.
  assert.match(frame, /title, info, chip, facts, tabs, actions, children/);
});

test("a record under a step keeps the step; Compliance settings is not a step", () => {
  for (const [path, step] of [["/app/complaints/0b5c1f3e-0000-4000-8000-000000000000", "complaints"], ["/app/complaints/new", "complaints"], ["/app/deletion-requests/x", "deletions"], ["/app/consent/x", "consent"], ["/app/tcpa/exemptions/new", "dnc"]]) {
    assert.equal(complianceStepOf(path), step, path);
  }
  assert.equal(complianceStepOf("/app/compliance/settings"), null);
  assert.match(read("components/ui/page-trail.tsx"), /const below = title\.trim\(\) && title !== label;\n\s+return <Breadcrumbs crumbs=\{\[\{ label: "Compliance"/);
});

test("no notice on the page: no Next up line, no hand-tinted box, no Callout inside the check's answer", () => {
  for (const file of SCREENS) {
    const source = read(file);
    assert.doesNotMatch(source, /<NextUp\b|lead-sources\/next-up/, `${file}: the Next up strip is retired`);
    assert.doesNotMatch(source, /bg-\[var\(--(warning|error|info)-surface\)\]/, `${file}: a tinted notice on the page`);
  }
  const tcpa = read("components/app/suppression-workspace.tsx");
  assert.doesNotMatch(tcpa.slice(tcpa.indexOf("{check ? (")), /^\s*<Callout/m, "the verdict is the result asked for, not a bell notice");
  assert.match(tcpa, /<StatusChip tone="danger">Do not call<\/StatusChip> : <StatusChip tone="good">Can call<\/StatusChip>/);
});

test("pop-ups only confirm or upload: forms and records are pages", () => {
  for (const file of ["components/app/tcpa-dnc-exemptions.tsx", "components/app/consent-locker-workspace.tsx", "components/app/compliance/complaints-board.tsx", "components/app/compliance/deletion-requests-board.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /<(Dialog|DialogContent|Sheet|DetailPanel)\b/, `${file}: only ConfirmDialog`);
  }
  // r7 2·1 (2026-11-11): TCPA / DNC's one other pop-up is Check a number, the answer to a question, not a form.
  const tcpaDialogs = read("components/app/suppression-workspace.tsx").match(/<DialogTitle>[^<]*<\/DialogTitle>/g) ?? [];
  assert.deepEqual(tcpaDialogs, ["<DialogTitle>Can we call this number?</DialogTitle>"]);
  assert.doesNotMatch(read("components/app/suppression-workspace.tsx"), /<(Sheet|DetailPanel)\b/);
  for (const file of RECORDS) assert.ok(existsSync(join(process.cwd(), file)), file);
  // The list rows open the record pages; the old ?open= links land on them.
  assert.match(read("components/app/compliance/complaints-board.tsx"), /href=\{`\/app\/complaints\/\$\{c\.id\}`\}/);
  assert.match(read("components/app/compliance/deletion-requests-board.tsx"), /href=\{`\/app\/deletion-requests\/\$\{r\.id\}`\}/);
  // Round 7 (3·A): every lead's row opens its consent record, its best certificate or the lead itself.
  assert.match(read("components/app/consent-locker-workspace.tsx"), /const href = consentRecordHref\(row, filter\);/);
  assert.match(read("lib/compliance/consentView.ts"), /`\/app\/consent\/\$\{row\.artefactId \?\? row\.leadId\}/);
  assert.match(read("app/app/(shell)/complaints/page.tsx"), /if \(open && \/\^\[0-9a-f-\]\{36\}\$\/i\.test\(open\)\) redirect\(`\/app\/complaints\/\$\{open\}`\);/);
  // The new-record forms hold a draft, so they have Discard, Save and a leave guard.
  for (const file of ["components/app/compliance/complaints-board.tsx", "components/app/compliance/deletion-requests-board.tsx", "components/app/tcpa-dnc-exemptions.tsx"]) {
    assert.match(read(file), /<LeaveGuard dirty=/, file);
  }
});

test("each record page: title, status chip, one facts line, tabs in the sub-page bar", () => {
  for (const file of ["app/app/(shell)/consent/[id]/page.tsx", "app/app/(shell)/complaints/[id]/page.tsx", "app/app/(shell)/deletion-requests/[id]/page.tsx"]) {
    const page = read(file);
    assert.match(page, /<ComplianceFlowPage\n\s+step="\w+"\n\s+title=\{/, file);
    // Round 7 (owner 2026-11-11): a consent record's title is the lead's name alone; its chip is in the strip.
    if (file.includes("/consent/")) {
      assert.doesNotMatch(page, /\bchip=\{/, file);
      assert.match(page, /<RecordStepper noun="lead"/, file);
      assert.match(page, /<StatStrip label=/, file);
    } else if (file.includes("/complaints/") || file.includes("/deletion-requests/")) {
      // Round 7 (4·1, 5·1): the complainant / the person alone on the title; the chip and the facts are the strip.
      assert.doesNotMatch(page, /\bchip=\{/, file);
      assert.doesNotMatch(page, /\bfacts=\{/, file);
      assert.match(page, /<RecordStepper noun="(complaint|request)"/, file);
      assert.match(page, /<StatStrip label=/, file);
    } else {
      assert.match(page, /chip=\{<StatusChip/, file);
      assert.match(page, /facts=\{facts\}/, file);
    }
    assert.match(page, /tabs=\{<ViewTabs/, file);
    assert.match(page, /guardPage\(/, `${file} keeps the step's gate`);
  }
  // A server page reads plain modules, never a value exported by a "use client" file.
  for (const file of ["app/app/(shell)/complaints/[id]/page.tsx", "app/app/(shell)/deletion-requests/[id]/page.tsx", "app/app/(shell)/evidence-report/page.tsx"]) {
    assert.doesNotMatch(read(file), /import \{[^}]*\b(COMPLAINT_TONE|complaintTitle|DELETION_TONE|deletionWho|SEVERITY_TONE|evidenceQuery)\b[^}]*\} from "@\/components\//, file);
  }
});

test("the figures are links to the rows behind them", () => {
  const linked = (file, min) => {
    // A tile's props run to its "/>" (a prop may hold a ">" of its own: `failing.length > 0`).
    const tiles = read(file).split(/<StatTile\s/).slice(1).map((rest) => rest.slice(0, rest.indexOf("/>")));
    assert.ok(tiles.filter((tile) => /\bhref=/.test(tile)).length >= min, `${file}: at least ${min} tiles link`);
    assert.ok(tiles.every((tile) => !/\baction=\{/.test(tile)), `${file}: the tile is the link, not a link inside it`);
  };
  linked("components/app/suppression-workspace.tsx", 3);
  linked("components/app/consent-locker-workspace.tsx", 3);
  linked("components/app/compliance/complaints-board.tsx", 4);
  linked("components/app/compliance/deletion-requests-board.tsx", 3);
  linked("components/app/compliance/evidence-report.tsx", 4);
  linked("components/app/carrier-appointments-page.tsx", 3);
  linked("app/app/(shell)/compliance/page.tsx", 1);
});

test("tabs are addresses, so a figure or a link can open one", () => {
  // Kept in the address in place, so a reload or a shared link opens the tab (QA 2026-11-03).
  assert.match(read("components/app/suppression-workspace.tsx"), /const \{ tab, setTab \} = useUrlTab<Tab>\(TABS, "list"\);/);
  assert.match(read("components/app/consent-locker-workspace.tsx"), /params\.get\("view"\) === "coverage"/);
  // Round 7 (2026-11-11): Blockers first; ?tab=cover, Trainings' old key, still opens Trainings.
  assert.match(read("components/app/carrier-appointments-page.tsx"), /const TABS: Tab\[\] = \["blockers", "appointments", "licences", "trainings"\];/);
  assert.match(read("components/app/carrier-appointments-page.tsx"), /useUrlTab<Tab>\(TABS, "blockers", "tab", \{ cover: "trainings" \}\)/);
  assert.match(read("app/app/(shell)/complaints/page.tsx"), /const view: ComplaintView = asked === "due" \|\| asked === "all" \? asked : "open";/);
  assert.match(read("app/app/(shell)/deletion-requests/page.tsx"), /const queue: DeletionQueue =/);
  assert.match(read("app/app/(shell)/evidence-report/page.tsx"), /EVIDENCE_VIEWS\.includes\(q\.view as EvidenceView\)/);
});

test("tables fill the card by themselves: no hand-made FILL heights", () => {
  for (const file of SCREENS) assert.doesNotMatch(read(file), /const (FILL|LEADS_FILL) =|min-h-\[420px\]/, file);
  // The widest tables were cut down to fit the card at 1280 (exemptions 11 columns, the audit 9).
  assert.doesNotMatch(read("components/app/tcpa-dnc-exemptions.tsx"), /min-w-\[1280px\]/);
  assert.doesNotMatch(read("components/app/tcpa-screening-audit.tsx"), /min-w-\[1180px\]/);
});

test("the evidence report keeps the spec's order and exports", () => {
  const page = read("app/app/(shell)/evidence-report/page.tsx");
  assert.match(page, /\{ key: "gaps", label: "Gaps"[\s\S]*\{ key: "consent"[\s\S]*\{ key: "leads"[\s\S]*\{ key: "timeline"/, "gaps first");
  assert.match(page, /format=pdf/);
  assert.match(page, /format=csv/);
  // The scope picker is the scan table's toolbar, never a card of its own.
  assert.match(read("components/app/compliance/evidence-report.tsx"), /<TableCard toolbar=\{<ScopeToolbar query=\{query\} \/>\}>/);
});
