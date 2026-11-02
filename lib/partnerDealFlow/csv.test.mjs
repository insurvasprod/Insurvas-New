import test from "node:test";
import assert from "node:assert/strict";

import { PARTNER_DEAL_FLOW_CSV_HEADER, partnerDealFlowCsv } from "./csv.ts";
import { sampleDealFlow } from "./fixtures.ts";

/**
 * A partner reconciles a published statement against this file, so a shifted column or a dropped
 * row is a dispute about money rather than a cosmetic bug. These hold the file to the rows it was
 * given.
 */

const DAY = "2026-11-02";

const row = (over = {}) => ({
  leadId: "lead-1",
  day: DAY,
  customer: "Marcus Bell",
  productLine: "final_expense",
  stageName: "Issued",
  stageType: "won",
  carrier: "Mutual of Omaha",
  productType: "Whole life",
  monthlyPremiumCents: 8_450,
  faceAmountCents: 1_500_000,
  draftDate: "2026-11-15",
  outcome: "Application submitted",
  submittedBy: { id: "u-me", name: "Rion Test" },
  submittedDay: "2026-11-02",
  updatedAt: "2026-11-02T16:40:00.000Z",
  ...over,
});

/** A quote-aware reader, so a comma inside a cell does not look like a new column. */
function parse(csv) {
  return csv.split("\n").map((line) => {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (quoted && char === '"' && line[i + 1] === '"') { cell += '"'; i += 1; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (char === "," && !quoted) { cells.push(cell); cell = ""; continue; }
      cell += char;
    }
    cells.push(cell);
    return cells;
  });
}

test("the header names every column the table shows", () => {
  const [header] = parse(partnerDealFlowCsv([]));
  assert.deepEqual(header, [...PARTNER_DEAL_FLOW_CSV_HEADER]);
});

test("an empty day is a header and nothing else, not an empty file", () => {
  // A zero-byte download looks like a failure. One header row reads as "nothing happened".
  assert.equal(partnerDealFlowCsv([]), PARTNER_DEAL_FLOW_CSV_HEADER.map((h) => `"${h}"`).join(","));
});

test("every row becomes exactly one line, in the order given", () => {
  const rows = [row({ customer: "First" }), row({ customer: "Second" }), row({ customer: "Third" })];
  const lines = parse(partnerDealFlowCsv(rows));
  assert.equal(lines.length, 4, "header plus three");
  assert.deepEqual(lines.slice(1).map((line) => line[1]), ["First", "Second", "Third"]);
});

test("each cell lands under its own heading", () => {
  const [header, line] = parse(partnerDealFlowCsv([row()]));
  const at = (name) => line[header.indexOf(name)];
  assert.equal(at("Day"), DAY);
  assert.equal(at("Customer"), "Marcus Bell");
  assert.equal(at("Product"), "final_expense");
  assert.equal(at("Stage"), "Issued");
  assert.equal(at("Carrier"), "Mutual of Omaha");
  assert.equal(at("Plan"), "Whole life");
  assert.equal(at("Draft date"), "2026-11-15");
  assert.equal(at("Outcome"), "Application submitted");
  assert.equal(at("Submitted by"), "Rion Test");
  assert.equal(at("Submitted"), "2026-11-02");
});

/* ── Money ────────────────────────────────────────────────────────────────────────────────────── */

test("money is written in units, so a spreadsheet can sum the column", () => {
  const [header, line] = parse(partnerDealFlowCsv([row()]));
  assert.equal(line[header.indexOf("Monthly premium")], "84.50", "8,450 cents is $84.50 — cents summed raw would be nonsense");
  assert.equal(line[header.indexOf("Face amount")], "15000.00", "1,500,000 cents is $15,000");
});

test("a deal the agency has not priced yet leaves the cell empty, never a zero", () => {
  // A 0.00 in a premium column reads as "sold for nothing" and drags any average down.
  const [header, line] = parse(partnerDealFlowCsv([row({ monthlyPremiumCents: null, faceAmountCents: null })]));
  assert.equal(line[header.indexOf("Monthly premium")], "");
  assert.equal(line[header.indexOf("Face amount")], "");
});

test("an empty optional field is empty, not the dash the table draws", () => {
  const [header, line] = parse(partnerDealFlowCsv([row({ carrier: null, productType: null, draftDate: null, outcome: null })]));
  for (const column of ["Carrier", "Plan", "Draft date", "Outcome"]) {
    assert.equal(line[header.indexOf(column)], "", column);
  }
});

/* ── What a hostile cell could do ─────────────────────────────────────────────────────────────── */

test("a customer name that would run as a formula is neutralised", () => {
  // The partner's own closer typed this name. Opened in Excel it would otherwise execute.
  const csv = partnerDealFlowCsv([row({ customer: "=HYPERLINK(\"http://evil.test\",\"click\")" })]);
  assert.match(csv, /"'=HYPERLINK/, "guarded with a leading apostrophe");
});

test("a comma or a quote in a name does not shift the columns", () => {
  const [header, line] = parse(partnerDealFlowCsv([row({ customer: 'Bell, Marcus "Marc"' })]));
  assert.equal(line.length, header.length, "still one cell per column");
});

/* ── Against the sample day the preview draws ─────────────────────────────────────────────────── */

test("the CSV holds exactly the rows the page was given", () => {
  const payload = sampleDealFlow({ state: "busy", role: "partner_admin", day: DAY });
  const lines = parse(partnerDealFlowCsv(payload.rows));
  assert.equal(lines.length, payload.rows.length + 1);
  assert.deepEqual(lines.slice(1).map((line) => line[1]), payload.rows.map((r) => r.customer));
});

test("a partner user's CSV is their own rows only, because that is the payload it is given", () => {
  // The narrowing is the service's, not this file's — what matters here is that nothing is added
  // back. Same day, same call, fewer rows.
  const admin = sampleDealFlow({ state: "busy", role: "partner_admin", day: DAY });
  const user = sampleDealFlow({ state: "busy", role: "partner_user", day: DAY });
  assert.ok(user.rows.length < admin.rows.length);
  assert.equal(parse(partnerDealFlowCsv(user.rows)).length, user.rows.length + 1);
});
