// The file checker (Owner request 2026-10-14): it suggests a layout and carrier from the headers; a person confirms.
import test from "node:test";
import assert from "node:assert/strict";

import { checkFile, clearlyBetter } from "./fileCheck.ts";
import { detectHeaderRow, parseCsvGrid } from "./grid.ts";

const carriers = [
  { id: "c-am", code: "AMAM", name: "American Amicable" },
  { id: "c-oc", code: "OCCA", name: "Occidental Life" },
  { id: "c-ae", code: "AETNA", name: "Aetna" },
];

const amPolicies = {
  layoutKey: "amam_policies",
  name: "American Amicable · Policies",
  fileType: "policies",
  pdfLayout: null,
  carriers: [{ id: "c-am", name: "American Amicable" }, { id: "c-oc", name: "Occidental Life" }],
  entries: [
    { sourceColumn: "Policy Number", required: true },
    { sourceColumn: "Status", required: true },
    { sourceColumn: "Paid To Date", required: false },
    { sourceColumn: "Modal Premium", required: false },
    { sourceColumn: "Agent Name", required: false },
  ],
};
const amCommissions = {
  layoutKey: "amam_commissions",
  name: "American Amicable · Commissions",
  fileType: "commissions",
  pdfLayout: null,
  carriers: [{ id: "c-am", name: "American Amicable" }],
  entries: [
    { sourceColumn: "Policy Number", required: true },
    { sourceColumn: "Amount", required: true },
    { sourceColumn: "Type", required: true },
    { sourceColumn: "Agent Name", required: false },
  ],
};
const aetnaPolicies = {
  layoutKey: "aetna_policies",
  name: "Aetna · Policies",
  fileType: "policies",
  pdfLayout: null,
  carriers: [{ id: "c-ae", name: "Aetna" }],
  entries: [
    { sourceColumn: "Policy #", required: true },
    { sourceColumn: "Policy Status", required: true },
    { sourceColumn: "Insured", required: false },
  ],
};
const americoPdf = {
  layoutKey: "americo_commissions_pdf",
  name: "Americo · Commission statement",
  fileType: "commissions",
  entries: [{ sourceColumn: "Policy", required: true }, { sourceColumn: "Amount", required: true }],
  carriers: [{ id: "c-am", name: "American Amicable" }],
  pdfLayout: {
    columns: [{ name: "Policy", x: 0 }, { name: "Insured", x: 100 }, { name: "Amount", x: 300 }],
    rowStart: { column: "Policy", pattern: "^[A-Z]{2}\\d{4,}$" },
    start: "TRANSACTION DETAIL",
  },
};
const layouts = [amPolicies, amCommissions, aetnaPolicies, americoPdf];

const sheet = (csv) => {
  const grid = parseCsvGrid(csv);
  return grid[detectHeaderRow(grid) - 1];
};

test("a policy file's headers point at its layout, with every column counted", () => {
  const headers = sheet("Book of business as of 10/01/2026,,,,\nPolicy Number,Status,Paid To Date,Modal Premium,Agent Name\nAM1,Active,10/01/2026,45.00,Lee\n");
  const result = checkFile({ file: { kind: "sheets", sheets: [{ name: null, headers }] }, layouts, filename: "drop.csv", carriers });
  const best = result.matches[0];
  assert.equal(best.layoutKey, "amam_policies");
  assert.equal(best.fit, 100);
  assert.equal(best.matched, 5);
  assert.equal(best.total, 5);
  assert.deepEqual(best.missingRequired, []);
  // Two carriers share the layout and the name says neither: no carrier is picked for the person.
  assert.equal(best.carrierId, null);
  // A PDF layout is never offered for a spreadsheet.
  assert.ok(result.matches.every((match) => match.layoutKey !== "americo_commissions_pdf"));
});

test("headers are compared trimmed and without case", () => {
  const result = checkFile({ file: { kind: "sheets", sheets: [{ name: null, headers: ["  policy number ", "STATUS", "paid to  date", "", "Something New"] }] }, layouts });
  const best = result.matches[0];
  assert.equal(best.layoutKey, "amam_policies");
  assert.equal(best.matched, 3);
  assert.equal(best.total, 4);
  assert.equal(best.fit, 75);
});

test("a layout missing a required column ranks below one that has them all, and says which", () => {
  const result = checkFile({ file: { kind: "sheets", sheets: [{ name: null, headers: ["Policy Number", "Agent Name", "Amount", "Type"] }] }, layouts });
  assert.equal(result.matches[0].layoutKey, "amam_commissions");
  assert.equal(result.matches[0].fit, 100);
  const policies = result.matches.find((match) => match.layoutKey === "amam_policies");
  assert.deepEqual(policies.missingRequired, ["Status"]);
  assert.ok(policies.score < result.matches[0].score);
});

test("the file name picks among carriers sharing a layout, and gives the date", () => {
  const headers = ["Policy Number", "Status", "Paid To Date", "Modal Premium", "Agent Name"];
  const result = checkFile({ file: { kind: "sheets", sheets: [{ name: null, headers }] }, layouts, filename: "safeharbor_occidental_policy_2026-10-01.csv", carriers });
  assert.equal(result.matches[0].carrierId, "c-oc");
  assert.equal(result.fromName.fileDate, "2026-10-01");
  assert.equal(result.fromName.fileType, "policies");
});

test("a workbook is matched on its best sheet, hidden or not", () => {
  const result = checkFile({
    file: { kind: "sheets", sheets: [{ name: "Summary", headers: ["Total", "Count"] }, { name: "Detail", headers: ["Policy #", "Policy Status", "Insured"] }] },
    layouts,
  });
  assert.equal(result.matches[0].layoutKey, "aetna_policies");
  assert.equal(result.matches[0].sheetName, "Detail");
  assert.equal(result.matches[0].carrierId, "c-ae");
});

test("a file nobody's layout knows gets no suggestion", () => {
  const result = checkFile({ file: { kind: "sheets", sheets: [{ name: null, headers: ["Foo", "Bar"] }] }, layouts });
  assert.deepEqual(result.matches, []);
});

test("a PDF is matched on its start line, its column names and the rows the layout cuts", () => {
  const line = (pieces) => ({ pieces, text: pieces.map((piece) => piece.text).join("  ") });
  const lines = [
    line([{ x: 0, text: "Americo Financial" }]),
    line([{ x: 0, text: "TRANSACTION DETAIL" }]),
    line([{ x: 0, text: "Policy" }, { x: 100, text: "Insured" }, { x: 300, text: "Amount" }]),
    line([{ x: 0, text: "AM12345" }, { x: 100, text: "Lee" }, { x: 300, text: "12.50" }]),
  ];
  const result = checkFile({ file: { kind: "pdf", lines }, layouts });
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].layoutKey, "americo_commissions_pdf");
  assert.equal(result.matches[0].pdfRows, 1);
  assert.equal(result.matches[0].fit, 100);
  const other = checkFile({ file: { kind: "pdf", lines: [line([{ x: 0, text: "Some other statement" }])] }, layouts });
  assert.deepEqual(other.matches, []);
});

test("clearlyBetter names another layout only when it fits and the file's own does not", () => {
  const result = checkFile({ file: { kind: "sheets", sheets: [{ name: null, headers: ["Policy Number", "Agent Name", "Amount", "Type"] }] }, layouts });
  assert.equal(clearlyBetter(result, "amam_policies")?.layoutKey, "amam_commissions");
  assert.equal(clearlyBetter(result, "amam_commissions"), null);
});

test("a joined source column needs each of its parts, and a fixed value needs none", () => {
  const layouts = [{
    layoutKey: "joined", name: "Joined", fileType: "policies", carriers: [{ id: "c1", name: "Carrier One" }], pdfLayout: null,
    entries: [
      { sourceColumn: "Policy Number", required: true },
      { sourceColumn: "Status + Reason", required: true },
      { sourceColumn: "=annual", required: false },
    ],
  }];
  const [match] = checkFile({ file: { kind: "sheets", sheets: [{ name: null, headers: ["Policy Number", "Status", "Reason"] }] }, layouts }).matches;
  assert.deepEqual(match.missingRequired, []);
  assert.equal(match.fit, 100);
  const [short] = checkFile({ file: { kind: "sheets", sheets: [{ name: null, headers: ["Policy Number", "Status"] }] }, layouts }).matches;
  assert.deepEqual(short.missingRequired, ["Status + Reason"]);
});
