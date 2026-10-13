// One-Path Plan, Phase 2 (in-spec items): one person is one client (LA-0.6, LA-4.9 queue 3), and a
// sale recorded as issued is in the Policies list before its carrier file (Module 4, Door 1).
import test from "node:test";
import assert from "node:assert/strict";

const { chooseExistingClient } = await import("./exceptionQueues.ts");
const { AWAITING_FILE, csvRows, filterRows, EMPTY_FILTERS, rowStatusLabel } = await import("./policyBook.ts");

const client = (id, provisional, created_at) => ({ id, provisional, created_at });

test("a carrier policy or a sale reuses the one confirmed client over carrier-made copies", () => {
  assert.equal(chooseExistingClient([client("p", true, "2026-10-01"), client("c", false, "2026-10-05")])?.id, "c");
  assert.equal(chooseExistingClient([client("c", false, "2026-10-05")])?.id, "c");
});

test("with no confirmed client, the oldest carrier-made one is reused instead of making another", () => {
  assert.equal(chooseExistingClient([client("p2", true, "2026-10-12"), client("p1", true, "2026-10-01")])?.id, "p1");
});

test("two confirmed clients with one identity are a duplicate for a person, so nothing is picked", () => {
  assert.equal(chooseExistingClient([client("a", false, "2026-10-01"), client("b", false, "2026-10-02")]), null);
  assert.equal(chooseExistingClient([]), null);
});

const row = (over) => ({ carrierId: "c1", carrierName: "Acme", policyNumber: "P1", clientName: "Pat", contactId: null, provisional: false, product: null, premiumCents: 5000, premiumMode: "monthly", annualCents: 60000, faceCents: 1000000, status: "active", statusRaw: "Active", daysPastDue: null, daysLeft: null, riskBand: "none", issueDate: "2026-08-16", agentUserId: null, agentName: null, agency: null, leadSource: null, ...over });

test("a recorded sale awaiting its file says so, and the source filter tells the three apart", () => {
  const carrier = row({});
  const hand = row({ policyNumber: "H1", source: "hand" });
  const issued = row({ policyNumber: "S1", source: "issued", status: null, statusRaw: null });
  assert.equal(rowStatusLabel(issued), AWAITING_FILE);
  assert.equal(rowStatusLabel(carrier), "Active");
  const pick = (source) => filterRows([carrier, hand, issued], { ...EMPTY_FILTERS, source }).map((r) => r.policyNumber);
  assert.deepEqual(pick(""), ["P1", "H1", "S1"]);
  assert.deepEqual(pick("carrier"), ["P1"]);
  assert.deepEqual(pick("hand"), ["H1"]);
  assert.deepEqual(pick("issued"), ["S1"]);
  const csv = csvRows([issued])[0];
  assert.equal(csv[8], AWAITING_FILE);
  assert.equal(csv.at(-1), "Recorded sale");
});
