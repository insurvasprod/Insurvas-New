// Reads docs/la4/demo/clean-demo/ back the way the app does (the same sheet choice, header row, PDF
// layout, totals check and layout map as lib/ingestion/bucketLayouts.test.mjs), then runs the app's own
// calculations on the result: the policies' computed fields, the expected commission from RATES, and the
// discrepancy engine. Prints what the demo should show, and fails if it is not exactly the plan.
//
//   node scripts/la4-demo-clean-dataset.check.mjs [YYYY-MM-DD]   (the demo day; default today)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ASSIGNMENTS, LATER_VERSIONS, LAYOUTS, entriesOf, latestOf, pdfOf } from "./la4-bucket-layouts.mjs";
import { FILES, PLANTED, POLICY_FILE_DATE, RATES, book } from "./la4-demo-clean-dataset.mjs";
import { readXlsxSheets } from "../lib/agentTemplates/xlsx.ts";
import { chooseSheet, parseCsvGrid, rawRowsFromGrid } from "../lib/ingestion/grid.ts";
import { mapProblems, parseWithMap } from "../lib/ingestion/layout.ts";
import { pdfGrid, statementProblem } from "../lib/ingestion/pdfLayout.ts";
import { readPdfLines } from "../lib/ingestion/pdfText.ts";
import { readSpreadsheetMl } from "../lib/ingestion/spreadsheetMl.ts";
import { annualisedPremiumCents, computeCurrent } from "../lib/ingestion/policyCurrent.ts";
import { expectedFor, triggerOccurredOn } from "../lib/ingestion/expectedCommission.ts";
import { detect } from "../lib/ingestion/discrepancyEngine.ts";

void LATER_VERSIONS;
const today = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const OUT = new URL("../docs/la4/demo/clean-demo/", import.meta.url);
// The platform's approved words for what these files say (carrier_status_map, approved 2026-10-08).
const STATUS = { "Active - Premium paying": "active", Active: "active", "Active (inforce)": "active", Inforce: "active" };

async function read(carrier, type, file) {
  const key = ASSIGNMENTS.find(([c, t]) => c === carrier && t === type)[2];
  const layout = latestOf(LAYOUTS.find((l) => l.key === key));
  const bytes = new Uint8Array(readFileSync(new URL(`${type === "policies" ? "policies" : "commissions"}/${file}`, OUT)));
  let grid, sheetName = null, statement = null;
  if (file.endsWith(".pdf")) {
    const lines = await readPdfLines(bytes);
    statement = statementProblem(lines, pdfOf(layout));
    grid = pdfGrid(lines, pdfOf(layout));
  } else if (file.endsWith(".xlsx") || file.endsWith(".xls")) {
    const sheets = file.endsWith(".xlsx") ? await readXlsxSheets(bytes.slice().buffer) : readSpreadsheetMl(new TextDecoder().decode(bytes)).map((s) => ({ name: s.name, grid: s.rows }));
    const chosen = chooseSheet(sheets, layout.sheet);
    sheetName = chosen.name; grid = chosen.grid;
  } else grid = parseCsvGrid(new TextDecoder().decode(bytes));
  const raw = { ...rawRowsFromGrid(grid, layout.headerRow), sheetName };
  const map = { id: layout.key, version: layout.version, fileType: layout.fileType, headerRowIndex: null, sheetName: layout.sheet, rowCountSwingPct: 50, totalRowColumn: null, totalRowValue: null };
  const entries = entriesOf(layout);
  assert.deepEqual(mapProblems(map, entries), []);
  return { result: parseWithMap({ map, entries, raw, previousRowCount: null }), statement };
}

const plan = book();
const policies = [], expected = [], entries = [];
let net = 0;
const report = [];
for (const [carrier, [policyFile, statementFile]] of Object.entries(FILES)) {
  const r = RATES[carrier];
  const pol = await read(carrier, "policies", policyFile);
  assert.equal(pol.result.fatal, null, `${carrier} policies: ${pol.result.fatal}`);
  assert.deepEqual(pol.result.heldBack, [], `${carrier} policies: rows held back`);
  const planned = plan.filter((p) => p.carrier === carrier);
  assert.equal(pol.result.rows.length, planned.length, `${carrier}: policy count`);
  for (const row of pol.result.rows) {
    const v = row.values;
    const p = planned.find((x) => x.number === v.policy_number);
    assert.ok(p, `${carrier}: unexpected policy ${v.policy_number}`);
    const status = STATUS[String(v.carrier_status_raw).trim()];
    assert.ok(status, `${carrier} ${p.number}: status "${v.carrier_status_raw}" has no approved mapping`);
    const annual = annualisedPremiumCents(v.premium_cents, v.premium_mode);
    assert.equal(annual, p.annualCents, `${carrier} ${p.number}: annual premium`);
    assert.equal(String(v.product_code ?? "").trim(), r.product.trim(), `${carrier} ${p.number}: product`);
    if (v.paid_to_date !== undefined && v.paid_to_date !== null) assert.equal(v.paid_to_date, p.paidTo, `${carrier} ${p.number}: paid to`);
    const current = computeCurrent({ asOf: today, status, paidToDate: v.paid_to_date ?? null, effectiveDate: v.effective_date ?? null, premiumCents: v.premium_cents, premiumMode: v.premium_mode, rule: null, clawbackMonths: null });
    policies.push({ carrierId: carrier, carrierName: r.name, policyNumber: p.number, status: current.status, inClawbackWindow: null, lapsedOn: null, monthsPaid: current.monthsPaid, dpd: current.daysPastDue });
    const trigger = r.pays === "On issue" ? "on_issue" : "on_first_draft";
    // issued_on comes from a change between two files, so one file gives none.
    const triggerDay = triggerOccurredOn(trigger, { issueDate: v.issue_date ?? null, issuedOn: null, effectiveDate: v.effective_date ?? null, paidTo: v.paid_to_date ?? null, firstSeenDate: POLICY_FILE_DATE }, null);
    const x = expectedFor({
      carrierId: carrier, policyNumber: p.number, trigger, lagDays: r.lag, triggerDay, family: r.family, carrierProductCode: r.product, levelBp: Math.round(r.level * 100), age: null, annualPremiumCents: annual,
      schedules: [{ id: `${carrier}-1`, productCode: r.family, levelBp: Math.round(r.level * 100), policyYear: 1, appliesOnward: false, rateBp: Math.round(r.rate * 100), effectiveFrom: "2026-01-01", bands: [] }],
      advanceRules: r.advance ? [{ productCode: r.family, advanceMonths: r.advance.months, advancePctBp: r.advance.pct * 100, effectiveFrom: "2026-01-01" }] : [],
    });
    if (r.noExpectedFromOneFile) { assert.equal(x, null, `${carrier}: expected an unpriced carrier`); continue; }
    assert.ok(x && x.confidence === "exact", `${carrier} ${p.number}: not priced`);
    assert.equal(x.expected_amount_cents, p.expectedCents);
    expected.push({ carrierId: carrier, policyNumber: p.number, policyYear: 1, confidence: x.confidence, trigger, triggerOn: x.trigger_occurred_on, overdueFrom: x.overdue_from, reason: x.reason,
      expectedAmountCents: x.expected_amount_cents, expectedAdvanceCents: x.expected_advance_cents, scheduleId: x.schedule_id, scheduleVersion: x.schedule_version, rateBp: x.rate_bp_applied, premiumCents: x.commissionable_premium_cents });
  }
  const st = await read(carrier, "commissions", statementFile);
  assert.equal(st.result.fatal, null, `${carrier} statement: ${st.result.fatal}`);
  assert.deepEqual(st.result.heldBack, [], `${carrier} statement: rows held back`);
  if (st.statement !== null) assert.equal(st.statement, null, `${carrier} statement does not balance: ${JSON.stringify(st.statement)}`);
  let total = 0;
  st.result.rows.forEach((row, i) => {
    const v = row.values;
    total += v.amount_cents;
    if (!v.policy_number) return; // an account-level line (Sentinel's advance interest)
    entries.push({ id: `${carrier}-${i}`, carrierId: carrier, policyNumber: v.policy_number, type: v.entry_type, correctsType: null, reversesEntryId: null, amountCents: v.amount_cents,
      transactionDate: v.transaction_date ?? null, statementDate: v.statement_date ?? null, rateBp: v.rate_bp ?? null, commissionablePremiumCents: v.commissionable_premium_cents ?? null, monthsAdvanced: v.months_advanced ?? null });
  });
  if (st.result.statedTotalCents !== null && st.result.statedTotalCents !== undefined) assert.equal(st.result.statedTotalCents, total, `${carrier}: stated total`);
  net += total;
  report.push(`${r.name.padEnd(24)} ${String(planned.length).padStart(2)} policies  ${String(st.result.rows.length).padStart(2)} lines  ${(total / 100).toFixed(2).padStart(10)}`);
}

const findings = detect({ today, policies, expected, entries, statements: [], carrierNames: new Map(Object.entries(RATES).map(([k, r]) => [k, r.name])), tolerance: () => 100 });
console.log(report.join("\n"));
console.log(`net received ${(net / 100).toFixed(2)}  ·  policies ${policies.length}  ·  priced ${expected.length}  ·  expected first-year ${(expected.reduce((s, x) => s + x.expectedAmountCents, 0) / 100).toFixed(2)}`);
console.log(`behind on premium (on ${today}):`, policies.filter((p) => (p.dpd ?? 0) > 0).map((p) => `${p.carrierName} ${p.policyNumber} (${p.dpd} days)`).join(", ") || "none");
console.log("findings:");
for (const f of findings) console.log(`  ${f.discrepancy_type} · ${RATES[f.carrier_id].name} ${f.policy_number} · difference ${f.difference_cents === null ? "—" : (f.difference_cents / 100).toFixed(2)}`);
const expectMissing = plan.find((p) => p.carrier === PLANTED.missing.carrier && p.index === PLANTED.missing.index);
const expectShort = plan.find((p) => p.carrier === PLANTED.short.carrier && p.index === PLANTED.short.index);
const want = [`missing|${expectMissing.number}`, `short_paid|${expectShort.number}`];
const got = findings.map((f) => `${f.discrepancy_type}|${f.policy_number}`).sort();
if (today < "2026-10-11") console.log("(before Oct 11 Aetna's missing commission is not overdue yet)");
assert.deepEqual(got, today < "2026-10-11" ? [want[1]] : want.sort(), "the findings are exactly the two planted ones");
assert.ok(net > 0, "the net is positive");
console.log("PASS: every file reads cleanly, every statement balances, and only the two planted problems are found");
