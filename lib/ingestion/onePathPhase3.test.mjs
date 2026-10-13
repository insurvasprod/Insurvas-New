// One-Path Plan, Phase 3 (in-spec items): a PDF statement the balance gate refused is laid out for a
// person — its lines beside its arithmetic (LA-4.4) — and a PDF profile is checked before it is
// approved, not when a file fails.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { balanceCheck, pdfLayoutProblems, PDF_TOTAL_MARKER } = await import("./pdfLayout.ts");

const line = (...pieces) => ({ pieces: pieces.map(([x, text]) => ({ x, text })), text: pieces.map(([, text]) => text).join(" ") });
const layout = {
  columns: [{ name: "Policy", x: 0 }, { name: "Amount", x: 100 }],
  rowStart: { column: "Policy", pattern: "^P\\d+$" },
  total: { label: "Total", column: "Amount" },
  balance: { opening: { label: "Opening" }, activity: { label: "Activity" }, closing: { label: "Closing" } },
};

test("the review shows the lines and where the arithmetic breaks", () => {
  const lines = [
    line([0, "Opening"], [100, "10.00"]),
    line([0, "P1"], [100, "50.00"]),
    line([0, "P2"], [100, "(20.00)"]),
    line([0, "Total"], [100, "40.00"]),
    line([0, "Activity"], [100, "40.00"]),
    line([0, "Closing"], [100, "50.00"]),
  ];
  const check = balanceCheck(lines, layout);
  assert.deepEqual(check.grid[0], ["Policy", "Amount"]);
  assert.deepEqual(check.grid.slice(1).map((row) => row[0]), ["P1", "P2"], "the statement-total row is not a line");
  assert.ok(!check.grid.some((row) => row[0] === PDF_TOTAL_MARKER));
  assert.equal(check.linesCents, 3000, "the lines add to $30.00");
  assert.equal(check.totalCents, 4000, "the statement says $40.00: a $10.00 line is missing");
  assert.equal(check.openingCents + check.activityCents, check.closingCents, "the balances themselves agree");
});

test("a statement without its stated amounts says so rather than guessing", () => {
  const check = balanceCheck([line([0, "P1"], [100, "5.00"])], layout);
  assert.equal(check.linesCents, 500);
  assert.equal(check.totalCents, null);
  assert.equal(check.closingCents, null);
});

test("a broken PDF profile is caught at publish, and an edited draft carries its profile", () => {
  assert.ok(pdfLayoutProblems({ columns: [{ name: "Only", x: 0 }], rowStart: { column: "Only", pattern: "(" } }).length >= 2);
  assert.deepEqual(pdfLayoutProblems(layout), []);
  const admin = readFileSync(new URL("./layoutAdmin.ts", import.meta.url), "utf8");
  assert.match(admin, /pdfLayoutProblems\(current\.pdfLayout\)/, "publish checks the PDF profile");
  assert.match(admin, /pdf_layout: input\.pdfLayout/, "a draft saves its PDF profile");
  assert.match(admin, /raw_columns/, "waiting-file headers come in the file's own order");
});
