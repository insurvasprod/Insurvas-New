import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAmountCents,
  parseStatementCsv,
  parseStatementDate,
  parseStatementKind,
  readStatementHeaders,
  sanitizeStatementMapping,
  statementHeaders,
  statementMappingProblem,
  suggestStatementMapping,
} from "./statementParse.ts";

test("amounts are read to whole cents without floating point, in the forms statements print", () => {
  assert.equal(parseAmountCents("1,234.56"), 123456);
  assert.equal(parseAmountCents("$1,234.56"), 123456);
  assert.equal(parseAmountCents("-12.00"), -1200);
  assert.equal(parseAmountCents("$-12.00"), -1200);
  assert.equal(parseAmountCents("(12.50)"), -1250);
  assert.equal(parseAmountCents("$(12.50)"), -1250);
  assert.equal(parseAmountCents("12.50-"), -1250);
  assert.equal(parseAmountCents("0.1"), 10);
  assert.equal(parseAmountCents(".07"), 7);
  assert.equal(parseAmountCents("1175"), 117500);
  assert.equal(parseAmountCents("USD 40.00"), 4000);
  // 0.1 + 0.2 is the reason for string arithmetic.
  assert.equal(parseAmountCents("0.30"), 30);
});

test("an amount that is not plainly an amount is refused, never rounded or guessed", () => {
  for (const bad of ["", "abc", "12.345", "1,23.00", "12..0", "--12", "$", ".", "1 2 3a"]) {
    assert.equal(parseAmountCents(bad), null, `"${bad}" must not read as an amount`);
  }
});

test("dates: ISO, US month/day, two-digit years and compact; impossible dates are refused", () => {
  assert.equal(parseStatementDate("2026-08-15"), "2026-08-15");
  assert.equal(parseStatementDate("2026-08-15T10:00:00Z"), "2026-08-15");
  assert.equal(parseStatementDate("8/15/2026"), "2026-08-15");
  assert.equal(parseStatementDate("08-15-26"), "2026-08-15");
  assert.equal(parseStatementDate("20260815"), "2026-08-15");
  assert.equal(parseStatementDate("2/30/2026"), null);
  assert.equal(parseStatementDate("15/08/2026"), null, "day-first is not a US statement date");
  assert.equal(parseStatementDate("next Tuesday"), null);
});

test("kinds: carrier wording maps to the four kinds, chargeback first, unknown words to null", () => {
  assert.equal(parseStatementKind("Advance"), "advance");
  assert.equal(parseStatementKind("ADV"), "advance");
  assert.equal(parseStatementKind("Advance Reversal"), "chargeback");
  assert.equal(parseStatementKind("Chargeback"), "chargeback");
  assert.equal(parseStatementKind("charge-back"), "chargeback");
  assert.equal(parseStatementKind("Clawback"), "chargeback");
  assert.equal(parseStatementKind("First Year Commission"), "commission");
  assert.equal(parseStatementKind("Renewal"), "commission");
  assert.equal(parseStatementKind("FYC"), "commission");
  assert.equal(parseStatementKind("Adjustment"), "adjustment");
  assert.equal(parseStatementKind("Bonus trip"), null);
});

test("headers are trimmed, blanks named, repeats numbered — so a raw row never loses a cell", () => {
  assert.deepEqual(statementHeaders(["﻿Policy", " Amount ", "", "Amount"]), ["Policy", "Amount", "Column 3", "Amount (2)"]);
  assert.deepEqual(readStatementHeaders("Policy #,Paid\r\nA,1\r\n"), ["Policy #", "Paid"]);
});

test("the mapping is suggested from carrier wording and refused until policy number and amount are chosen", () => {
  const headers = ["Agent", "Policy Number", "Insured Name", "Transaction Type", "Paid Date", "Commission Amount"];
  const mapping = suggestStatementMapping(headers);
  assert.deepEqual(mapping, { policyNumber: "Policy Number", amount: "Commission Amount", kind: "Transaction Type", lineDate: "Paid Date", insuredName: "Insured Name" });
  assert.equal(statementMappingProblem(mapping, headers), null);
  assert.match(statementMappingProblem({ amount: "Commission Amount" }, headers), /policy number/);
  assert.match(statementMappingProblem({ policyNumber: "Policy Number", amount: "Policy Number" }, headers), /one field only/);
  assert.deepEqual(sanitizeStatementMapping({ policyNumber: "Policy Number", amount: "Gone", evil: "x" }, headers), { policyNumber: "Policy Number" });
});

const CSV = [
  "Policy No,Insured,Type,Paid,Amount,Note",
  "POL-1,Grace Oyelaran,Advance,08/05/2026,\"$1,057.50\",",
  "POL-2,Dermot Shaw,Chargeback,08/12/2026,420.00,positive on the statement",
  "POL-3,Alonzo Pike,,2026-08-20,-35.10,",
  "POL-4,Marisol Vega,Bonus,2026-08-21,10.00,",
  ",Totals,,,\"1,452.40\",",
  "POL-5,Gracie Mbeki,Renewal,31/08/2026,12.00,extra,cells",
].join("\r\n");

const MAPPING = { policyNumber: "Policy No", insuredName: "Insured", kind: "Type", lineDate: "Paid", amount: "Amount" };

test("every data row becomes a line, keeping its cells verbatim", () => {
  const { headers, lines } = parseStatementCsv(CSV, MAPPING);
  assert.deepEqual(headers, ["Policy No", "Insured", "Type", "Paid", "Amount", "Note"]);
  assert.equal(lines.length, 6);
  assert.deepEqual(lines[0].raw, { "Policy No": "POL-1", Insured: "Grace Oyelaran", Type: "Advance", Paid: "08/05/2026", Amount: "$1,057.50", Note: "" });
  assert.equal(lines[5].raw["Column 7"], "cells", "a cell past the header is kept, not dropped");
  assert.deepEqual(lines.map((line) => line.lineNumber), [1, 2, 3, 4, 5, 6]);
});

test("a chargeback is negative whatever sign the carrier printed; no kind column falls back to the sign", () => {
  const { lines } = parseStatementCsv(CSV, MAPPING);
  assert.deepEqual([lines[0].kind, lines[0].amountCents, lines[0].kindFrom, lines[0].lineDate], ["advance", 105750, "column", "2026-08-05"]);
  assert.deepEqual([lines[1].kind, lines[1].amountCents], ["chargeback", -42000]);
  assert.deepEqual([lines[2].kind, lines[2].amountCents, lines[2].kindFrom], ["chargeback", -3510, "sign"]);
});

test("a row that cannot be read keeps its error and stays a line", () => {
  const { lines } = parseStatementCsv(CSV, MAPPING);
  assert.match(lines[3].error, /“Bonus” is not advance, commission, chargeback or adjustment/);
  assert.equal(lines[4].error, null, "a totals row reads fine; a person leaves it unmatched");
  assert.equal(lines[4].policyNumber, null);
  assert.match(lines[5].error, /“31\/08\/2026” is not a date/);
});

test("a file with no lines, or an incomplete mapping, is refused whole", () => {
  assert.throws(() => parseStatementCsv("Policy No,Amount\r\n", { policyNumber: "Policy No", amount: "Amount" }), /at least one line/);
  assert.throws(() => parseStatementCsv(CSV, { policyNumber: "Policy No" }), /amount/);
});
