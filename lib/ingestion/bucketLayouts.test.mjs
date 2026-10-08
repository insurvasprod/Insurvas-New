// Every bucket sample file (docs/la4/bucket-samples: synthetic data, real carrier layouts) read with
// its platform layout (scripts/la4-bucket-layouts.mjs), exactly as the app reads it: the right sheet,
// the header row, the PDF layout, then the layout map. Each policy file must give back the answer
// key's policies with their status, paid-to date and premium; each commission file must read every
// line it should and add up where the carrier states a total.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { ASSIGNMENTS, LATER_VERSIONS, LAYOUTS, entriesOf, latestOf, pdfOf } from "../../scripts/la4-bucket-layouts.mjs";
import { readXlsxSheets } from "../agentTemplates/xlsx.ts";
import { normalizeAccountLine } from "./commissionLedger.ts";
import { chooseSheet, parseCsvGrid, rawRowsFromGrid } from "./grid.ts";
import { mapProblems, parseWithMap } from "./layout.ts";
import { pdfGrid, pdfLayoutProblems } from "./pdfLayout.ts";
import { readPdfLines } from "./pdfText.ts";
import { readSpreadsheetMl } from "./spreadsheetMl.ts";

const ROOT = new URL("../../docs/la4/bucket-samples/", import.meta.url);
const DAY = new URL("09-01-2026/Sample Agency/", ROOT);
const FOLDER_CODE = { Aetna: "aetna", Aflac: "aflac", AHL: "american_home_life", AMAM: "american_amicable", Americo: "americo", Corebridge: "corebridge", "Mutual of Omaha": "mutual_of_omaha", SSL: "sentinel_security_life" };
const TYPE = { Policies: "policies", Commissions: "commissions", "New Business": "new_business" };

function answerKey() {
  const [header, ...rows] = parseCsvGrid(readFileSync(new URL("_answer_key_scenarios.csv", ROOT), "utf8")).filter((row) => row.length > 1);
  return rows.map((row) => Object.fromEntries(header.map((name, index) => [name, row[index] ?? ""])));
}

const iso = (us) => (us ? `${us.slice(6, 10)}-${us.slice(0, 2)}-${us.slice(3, 5)}` : null);
const cents = (text) => (text === "" ? null : Math.round(Number(text) * 100));

async function readSample(folder, typeFolder, file) {
  const url = new URL(`${folder}/${typeFolder}/${file}`, DAY);
  const code = FOLDER_CODE[folder];
  const fileType = TYPE[typeFolder];
  const key = ASSIGNMENTS.find(([c, t]) => c === code && t === fileType)?.[2];
  // The version the app reads today: the seed, or a later version from its own migration.
  const seeded = LAYOUTS.find((candidate) => candidate.key === key);
  const layout = seeded && latestOf(seeded);
  assert.ok(layout, `${folder}/${typeFolder} has a layout`);
  const bytes = new Uint8Array(readFileSync(url));
  let grid;
  let sheetName = null;
  if (file.endsWith(".pdf")) {
    assert.deepEqual(pdfLayoutProblems(pdfOf(layout)), [], `${layout.key}: the PDF layout is sound`);
    grid = pdfGrid(await readPdfLines(bytes), pdfOf(layout));
  } else if (file.endsWith(".xlsx") || file.endsWith(".xls")) {
    const sheets = file.endsWith(".xlsx")
      ? await readXlsxSheets(bytes.slice().buffer)
      : readSpreadsheetMl(new TextDecoder().decode(bytes)).map((sheet) => ({ name: sheet.name, grid: sheet.rows }));
    const chosen = chooseSheet(sheets, layout.sheet);
    sheetName = chosen.name;
    grid = chosen.grid;
  } else {
    grid = parseCsvGrid(new TextDecoder().decode(bytes));
  }
  const raw = { ...rawRowsFromGrid(grid, layout.headerRow), sheetName };
  const map = { id: layout.key, version: layout.version, fileType: layout.fileType, headerRowIndex: null, sheetName: layout.sheet, rowCountSwingPct: 50, totalRowColumn: null, totalRowValue: null };
  const entries = entriesOf(layout);
  assert.deepEqual(mapProblems(map, entries), [], `${layout.key}: the map is sound`);
  return { layout, result: parseWithMap({ map, entries, raw, previousRowCount: null }) };
}

const key = answerKey();

const POLICY_FILES = [
  ["Aetna", "Policies", "policySummary.xlsx", "Aetna"],
  ["Aflac", "Policies", "policySummary.xlsx", "Aflac"],
  ["AHL", "Policies", "policySummary.xlsx", "AHL"],
  ["AMAM", "Policies", "Policies.csv", "AMAM"],
  ["Americo", "Policies", "americo-policies-2026-09-08.xlsx", "Americo"],
  ["Corebridge", "Policies", "PolicySummary_09012026 (1).xlsx", "Corebridge"],
  ["Corebridge", "New Business", "PolicySummary_09012026.xlsx", "Corebridge-NB"],
  ["Mutual of Omaha", "Policies", "7376635-8641652185198.csv", "Mutual of Omaha"],
  ["SSL", "Policies", "PolicyList.xls", "SSL"],
];

for (const [folder, typeFolder, file, keyCarrier] of POLICY_FILES) {
  test(`${folder} ${typeFolder}: every answer-key policy, with its status, paid-to date and premium`, async () => {
    const { layout, result } = await readSample(folder, typeFolder, file);
    assert.equal(result.fatal, null);
    assert.deepEqual(result.heldBack, [], "no row held back");
    const expected = key.filter((row) => row.carrier === keyCarrier);
    const byNumber = new Map(result.rows.map((row) => [row.values.policy_number, row.values]));
    assert.deepEqual([...byNumber.keys()].sort(), expected.map((row) => row.policy_number).sort(), "the same policies");
    const annual = layout.entries.some(([source, target]) => source === "=annual" && target === "premium_mode");
    const readsPaidTo = layout.entries.some(([, target]) => target === "paid_to_date");
    for (const want of expected) {
      const got = byNumber.get(want.policy_number);
      // Aetna's platform writes "category / display text"; the layout reads the display text.
      const status = keyCarrier === "Aetna" || keyCarrier === "Aflac" || keyCarrier === "AHL" ? want.carrier_status.split(" / ").slice(1).join(" / ") : want.carrier_status;
      assert.equal(got.carrier_status_raw.trim(), status, `${want.policy_number} status`);
      // The key writes "paid to the effective date" for a policy nothing was paid on; a carrier may leave it blank.
      if (readsPaidTo && want.paid_to && !(got.paid_to_date === null && want.paid_to === want.effective)) assert.equal(got.paid_to_date, iso(want.paid_to), `${want.policy_number} paid-to`);
      const premium = cents(annual ? want.annual_premium : want.modal_premium);
      if (premium !== null && got.premium_cents !== null) assert.equal(got.premium_cents, premium, `${want.policy_number} premium`);
    }
  });
}

test("Aetna, Aflac and American Home Life commission details add up to each statement's total", async () => {
  for (const [folder, total] of [["Aetna", 144488], ["Aflac", 42293], ["AHL", 159927]]) {
    const { result } = await readSample(folder, "Commissions", "Commission-Detail.xlsx");
    assert.equal(result.fatal, null);
    assert.deepEqual(result.heldBack, []);
    assert.equal(result.rows.reduce((sum, row) => sum + row.values.amount_cents, 0), total, `${folder} total`);
    assert.ok(result.rows.every((row) => row.values.payee_level === "upline"), "the agency's override lines");
    assert.ok(result.rows.some((row) => row.values.entry_type === "advance" && row.values.months_advanced === 9));
  }
});

test("Mutual of Omaha's DETAILS lines add up to the SUMMARY's total compensation, -$2,105.95", async () => {
  const { result } = await readSample("Mutual of Omaha", "Commissions", "ebssr_e5112b32-f772-4e7c-86f7-7f361d8d8510.xlsx");
  assert.equal(result.fatal, null);
  assert.deepEqual(result.heldBack, []);
  assert.equal(result.rows.length, 11);
  assert.equal(result.rows.reduce((sum, row) => sum + row.values.amount_cents, 0), -210595);
  assert.deepEqual([...new Set(result.rows.map((row) => row.values.entry_type))].sort(), ["chargeback", "earned"]);
  assert.equal(result.rows[0].values.rate_bp, 8250);
});

test("American Amicable advances: one delivered advance, four recovered", async () => {
  const { result } = await readSample("AMAM", "Commissions", "Advances_0003559471_01Sep26.csv");
  assert.equal(result.fatal, null);
  assert.deepEqual(result.rows.map((row) => [row.values.policy_number, row.values.entry_type, row.values.amount_cents]), [
    ["0119859720", "chargeback", -88061], ["0119754283", "chargeback", -40623], ["0119106916", "chargeback", -35755], ["0119381414", "advance", 91857], ["0119872934", "chargeback", -65001],
  ]);
});

test("the PDF statements: Americo's override lines, Corebridge's weekly detail, SSL's account-level adjustment", async () => {
  const americo = await readSample("Americo", "Commissions", "Commissions - Statements - Agent Portal.pdf");
  assert.equal(americo.result.fatal, null);
  assert.deepEqual(americo.result.rows.map((row) => [row.values.policy_number, row.values.amount_cents, row.values.agent_identifier]), [
    ["AM09353024", 6170, "MML13W"], ["AM09473625", 6305, "MML51T"], ["AM09293835", 3269, "MML67Q"], ["AM09232886", 7740, "MML45W"],
  ]);
  assert.equal(americo.result.rows.reduce((sum, row) => sum + row.values.amount_cents, 0), 23484, "the PRIMARY BALANCE TOTAL, 234.84");
  assert.equal(americo.result.rows[0].values.transaction_date, "2026-09-01");
  assert.equal(americo.result.rows[0].values.rate_bp, 7500);

  const corebridge = await readSample("Corebridge", "Commissions", "view_statements.pdf");
  assert.equal(corebridge.result.fatal, null);
  assert.deepEqual(corebridge.result.heldBack, []);
  assert.equal(corebridge.result.rows.length, 7);
  assert.deepEqual(corebridge.result.rows.slice(0, 3).map((row) => [row.values.policy_number, row.values.entry_type, row.values.amount_cents]), [["7269651834", "earned", -6278], ["7269164405", "earned", 9274], ["7269408045", "advance", -89163]]);
  const keyed = new Set(key.filter((row) => row.carrier === "Corebridge").map((row) => row.policy_number));
  assert.ok(corebridge.result.rows.every((row) => keyed.has(row.values.policy_number)), "every line names a policy in the Corebridge file");

  // Version 2 (20261009130000): advance interest names no policy, and is recorded as an account line.
  const ssl = await readSample("SSL", "Commissions", "Statement_69148518058182096.pdf");
  assert.equal(ssl.layout.version, 2);
  assert.deepEqual(ssl.result.heldBack, []);
  assert.equal(ssl.result.rows.length, 1);
  assert.equal(ssl.result.rows[0].values.policy_number, null);
  const interest = normalizeAccountLine(ssl.result.rows[0]);
  assert.ok(interest.ok);
  assert.equal(interest.line.entry_type, "advance_interest");
  assert.equal(interest.line.amount_cents, -4625, "the $46.25 advance interest, a charge");
  assert.ok(interest.line.description, "the carrier's description of the line is kept");
});

test("every layout has its carriers, and every assignment its layout", () => {
  const keys = new Set(LAYOUTS.map((layout) => layout.key));
  for (const [, , layoutKey] of ASSIGNMENTS) assert.ok(keys.has(layoutKey), layoutKey);
  for (const layout of LAYOUTS) assert.ok(ASSIGNMENTS.some(([, type, layoutKey]) => layoutKey === layout.key && type === layout.fileType), `${layout.key} is used`);
  const files = readdirSync(DAY, { recursive: true }).filter((name) => /\.(csv|xlsx|xls|pdf)$/.test(name));
  assert.equal(files.length, 17, "the 17 sample files are all here");
});

test("a later layout version's migration seeds exactly the columns the samples are read with", () => {
  for (const [key, later] of Object.entries(LATER_VERSIONS)) {
    const sql = readFileSync(new URL(`../../supabase/migrations/${later.migration}_la_4_account_level_commission.sql`, import.meta.url), "utf8");
    assert.match(sql, new RegExp(`layout_key = '${key}' and version = ${later.version}`));
    later.entries.forEach(([source, target, dataType, transform, required], index) => {
      assert.ok(sql.includes(`(v_map, '${source}', '${target}', '${dataType}', '${transform}', ${required}, ${index + 1},`), `${key} v${later.version}: ${source} → ${target}`);
    });
  }
});