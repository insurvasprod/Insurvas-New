// Run with: npm test
//
// UX-2 · docs/design/UI-CONSISTENCY.md as a ratchet.
//
// Every rule below is counted per file across app/ and components/. Today's counts live in
// uiOffenders.json. The test fails when:
//   · a file's count goes UP, or a file that was clean starts offending — a new offender;
//   · a file's count goes DOWN without the baseline following — so a fix is recorded, and the
//     number can never quietly creep back up to where it was.
//
// After fixing offenders, lower the baseline with:
//     $env:UI_RATCHET_WRITE='1'; node --experimental-strip-types --test lib/design/uiConsistency.test.mjs
// The write mode only ever LOWERS counts (and drops files that reached zero). It cannot add an
// offender — a new one has to be fixed, not recorded. After splitting a file, `UI_RATCHET_WRITE=move`
// records where the offenders went, and refuses if any rule's total grew. (`UI_RATCHET_WRITE=init` rebuilds the file
// from scratch; use it only when a rule itself changes, and say so in review.)
//
// DB-free and network-free: this reads source text only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const BASELINE = join(ROOT, "lib/design/uiOffenders.json");

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const files = [...walk("app"), ...walk("components")].filter((f) => f.endsWith(".tsx")).sort();
// Comments are not UI: a doc comment saying 'never print "Loading…"' is not an offender.
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sources = new Map(files.map((f) => [f, stripComments(readFileSync(join(ROOT, f), "utf8"))]));
const count = (source, re) => (source.match(re) ?? []).length;
const appShell = (file) => file.startsWith("components/app/") || file.startsWith("app/app/");

/**
 * Files a rule does not apply to, each with its reason. Keep this short: an exemption is a decision,
 * not a place to park an offender.
 */
export const EXEMPT = {
  // Reviewed one by one on 2026-10-03 (UX-5). §6 governs a page's LIST; a small grid inside a
  // dialog, drawer or detail panel is not one, and wrapping it in a TableCard would put a card
  // inside a card (§8). Each entry says where its table lives.
  "raw-table": {
    "components/ui/table.tsx": "the table primitive itself",
    "app/app/discrepancies/letter/page.tsx": "a printed letter, not a list",
    "components/admin/invoice-print-view.tsx": "a printed invoice, not a list",
    "components/admin/invoice-detail-view.tsx": "line items and credit notes inside the invoice's detail cards",
    "components/admin/payment-status-panel.tsx": "payment attempts inside the payment status panel",
    "components/admin/tenant-record/subscription-cards.tsx": "a sub-table inside a subscription card",
    "components/admin/user-detail-tabs.tsx": "tables inside a user's detail tabs",
    "components/app/applications/draft-dates/draft-date-panel.tsx": "the arrival grid inside the draft-date panel",
    "components/app/applications/outcome/counteroffer-delta-dialog.tsx": "a before/after grid in a dialog",
    "components/app/applications/workspace/interview/medication-table.tsx": "an input grid inside the interview form",
    "components/app/campaign-speed-to-lead.tsx": "a small grid inside the campaign detail",
    "components/app/column-mapping-dialog.tsx": "a mapping preview in a dialog",
    "components/app/dialer-preflight.tsx": "a check grid inside the dial pre-flight",
    "components/app/dialer/lead-column.tsx": "attempt history in the dialer's lead column",
    "components/app/lead-list-assign-drawer.tsx": "the outcome preview inside the assign drawer",
    "components/app/partner-market-access-panel.tsx": "an access matrix inside a card",
    "components/app/partner-onboarding.tsx": "onboarding steps inside a card",
    "components/app/partner-quality-parts.tsx": "the lead list inside a drawer",
    "components/app/pipeline-views.tsx": "rendered inside lead-workspace.tsx's TableCard",
    "components/app/role-gate-notice.tsx": "a reach table inside a notice",
    "components/app/statement-import.tsx": "a mapping preview inside the import dialog",
  },
  "extra-page-header": {
    "app/app/(shell)/statements/[id]/page.tsx": "two exclusive branches (not found / the statement), one header each",
  },
};

/** Each rule: what it guards (UI-CONSISTENCY section), and a per-file count. */
export const RULES = {
  // §6 — a list is a TableCard; a bare <table> in a file that never uses one is a hand-made card.
  // (SettingsTableCard is the settings boards' table card and counts as one.)
  "raw-table": { section: "§6", measure: (source) => (/\b(?:Settings)?TableCard\b/.test(source) ? 0 : count(source, /<table\b/g)) },
  // §2 — one header per page.
  "extra-page-header": { section: "§2", pagesOnly: true, measure: (source) => { const n = count(source, /<(?:Admin)?PageHeader\b/g); return n > 1 ? n - 1 : 0; } },
  // §5 — one control height (36px) inside the agent app.
  "tall-control": { section: "§5", appShellOnly: true, measure: (source) => count(source, /\bh-1[01]\b|size="lg"/g) },
  // §9 — colours come from tokens, not hex literals.
  "hex-colour": { section: "§9", measure: (source) => count(source, /(?<![\w&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b(?![\w-])/g) },
  // Text stays on the 12/14px scale: arbitrary pixel sizes drift.
  "text-px": { section: "type scale", measure: (source) => count(source, /\btext-\[\d+(?:\.\d+)?px\]/g) },
  // §2 — no eyebrow above the title.
  eyebrow: { section: "§2", measure: (source) => count(source, /<(?:Admin)?PageHeader\b[^>]*?\beyebrow=/g) },
  // §7 — loading is a skeleton, never a sentence.
  "loading-text": { section: "§7", measure: (source) => count(source, /Loading(?:…|\.\.\.)/g) },
  // §6 — pagination is <Pager>, never a hand-rolled Previous/Next.
  "hand-pager": { section: "§6", measure: (source) => (/\bPrevious\b/.test(source) && /\bsetPage\(/.test(source) && !/\bPager\b/.test(source) ? 1 : 0) },
  // UX-5 — one chip: StatusChip. `Pill` is a deprecated alias and `Badge` is gone.
  "legacy-chip": { section: "UX-5", measure: (source) => count(source, /<(?:Pill|Badge)\b/g) },
  // §5 — <Button> over the settings btn() helper.
  "btn-helper": { section: "§5", measure: (source, file) => (file === "components/app/settings/primitives.tsx" ? 0 : count(source, /\bbtn\(/g)) },
};

function measureAll() {
  const result = {};
  for (const [rule, spec] of Object.entries(RULES)) {
    const perFile = {};
    for (const [file, source] of sources) {
      if (spec.pagesOnly && !file.endsWith("/page.tsx")) continue;
      if (spec.appShellOnly && !appShell(file)) continue;
      if (EXEMPT[rule]?.[file]) continue;
      const n = spec.measure(source, file);
      if (n > 0) perFile[file] = n;
    }
    result[rule] = perFile;
  }
  return result;
}

const current = measureAll();
const mode = process.env.UI_RATCHET_WRITE;

if (mode === "init" || (mode && !existsSync(BASELINE))) {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
} else if (mode === "move") {
  // A file split (UX-6) moves offenders into new files without adding any. Accepted only when no
  // rule's TOTAL went up; otherwise the write is refused and the per-file checks below fail as usual.
  const old = JSON.parse(readFileSync(BASELINE, "utf8"));
  const sum = (perFile) => Object.values(perFile ?? {}).reduce((a, b) => a + b, 0);
  const grew = Object.keys(RULES).filter((rule) => sum(current[rule]) > sum(old[rule]));
  if (grew.length === 0) writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  else console.error(`UI_RATCHET_WRITE=move refused: the total grew for ${grew.join(", ")}`);
} else if (mode) {
  const old = JSON.parse(readFileSync(BASELINE, "utf8"));
  const lowered = {};
  for (const rule of Object.keys(RULES)) {
    lowered[rule] = {};
    for (const [file, was] of Object.entries(old[rule] ?? {})) {
      const now = Math.min(was, current[rule][file] ?? 0);
      if (now > 0) lowered[rule][file] = now;
    }
  }
  writeFileSync(BASELINE, `${JSON.stringify(lowered, null, 2)}\n`);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const total = (perFile) => Object.values(perFile).reduce((sum, n) => sum + n, 0);

for (const [rule, spec] of Object.entries(RULES)) {
  test(`UI rule ${spec.section} · ${rule}: no new offender, and fixes are recorded`, () => {
    const was = baseline[rule] ?? {};
    const now = current[rule];
    const worse = Object.entries(now).filter(([file, n]) => n > (was[file] ?? 0)).map(([file, n]) => `${file}: ${was[file] ?? 0} → ${n}`);
    assert.deepEqual(worse, [], `New ${rule} offenders (docs/design/UI-CONSISTENCY.md ${spec.section}). Fix them; they cannot be added to the baseline.`);
    const better = Object.entries(was).filter(([file, n]) => (now[file] ?? 0) < n).map(([file, n]) => `${file}: ${n} → ${now[file] ?? 0}`);
    assert.deepEqual(better, [], `${rule} went down — lower the baseline (UI_RATCHET_WRITE=1, see the top of this file) so it cannot creep back.`);
  });
}

test("the ratchet's detectors still match something (a silent detector would pass everything)", () => {
  // Each rule has to find what it was written for in a known sample, so a regex typo cannot turn a
  // rule off. These samples are not files in the repo.
  const samples = {
    "raw-table": "<table className=\"x\">",
    "extra-page-header": "<PageHeader title=\"a\" /><PageHeader title=\"b\" />",
    "tall-control": "<Button className=\"h-10\" /> <Button size=\"lg\" />",
    "hex-colour": "style={{ color: \"#ff6600\", background: '#fff' }}",
    "text-px": "className=\"text-[13px]\"",
    eyebrow: "<PageHeader eyebrow=\"Book\" />",
    "loading-text": "<p>Loading…</p>",
    "hand-pager": "<button onClick={() => setPage(page - 1)}>Previous</button>",
    "btn-helper": "className={btn(\"primary\")}",
    "legacy-chip": "<Pill tone=\"success\">Live</Pill>",
  };
  for (const [rule, spec] of Object.entries(RULES)) assert.ok(spec.measure(samples[rule], "sample.tsx") > 0, `${rule} detects its sample`);
  // ...and do not fire on what they must allow.
  assert.equal(RULES["hex-colour"].measure("href=\"#beneficiaries\" #1 &#123; url(/a#abc)", "x"), 0);
  assert.equal(RULES["raw-table"].measure("<TableCard><table /></TableCard>", "x"), 0);
  assert.equal(RULES["text-px"].measure("text-sm text-[var(--x)]", "x"), 0);
  assert.equal(RULES.eyebrow.measure("<AuthCard eyebrow=\"Step 1 of 3\" />", "x"), 0, "an auth step label is not a page eyebrow");
  assert.equal(stripComments("/* Loading… */\n// Loading…\nconst a = 1;").includes("Loading"), false);
  assert.ok(stripComments("const a = 'https://x';").includes("https://x"), "a URL is not a comment");
});

// Zero tolerance, not a ratchet. A `table-fixed` table hands its flexible columns whatever its
// minimum width leaves after the fixed ones. Policies' columns added up to 990px against a 980px
// minimum, so Customer was 0px wide on any screen narrower than the table and names ran into
// Carrier (found 2026-10-03). Each flexible column needs at least 120px of the minimum.
test("no table-fixed table squeezes its flexible columns to nothing", () => {
  const squeezed = [];
  for (const [file, source] of sources) {
    for (const match of source.matchAll(/<table\b[^>]*className=\{?["`]([^"`]*)["`]/g)) {
      if (!match[1].includes("table-fixed")) continue;
      const end = source.indexOf("</thead>", match.index);
      if (end === -1) continue;
      const heads = [...source.slice(match.index, end).matchAll(/<th\b([^>]*)>/g)].map((m) => m[1]);
      const fixed = heads.map((attrs) => Number(attrs.match(/\bw-\[(\d+)px\]/)?.[1] ?? NaN));
      const flexible = fixed.filter(Number.isNaN).length;
      const minimum = Number(match[1].match(/min-w-\[(\d+)px\]/)?.[1] ?? 0);
      const room = minimum - fixed.filter((n) => !Number.isNaN(n)).reduce((a, b) => a + b, 0);
      if (flexible > 0 && room < 120 * flexible) squeezed.push(`${file}: min-w ${minimum}px leaves ${room}px for ${flexible} flexible column(s)`);
    }
  }
  assert.deepEqual(squeezed, []);
});

test("the offender totals, for the record", () => {
  const summary = Object.fromEntries(Object.keys(RULES).map((rule) => [rule, total(current[rule])]));
  // Printed, not asserted: the per-file checks above are the gate.
  console.log("UI offenders:", JSON.stringify(summary));
  assert.ok(Object.keys(summary).length === Object.keys(RULES).length);
});
