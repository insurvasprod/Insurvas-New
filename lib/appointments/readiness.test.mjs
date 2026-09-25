// Run with: npm test
//
// /app/appointments reads these answers: what each carrier × state cell says, what the Readiness
// card lists, and which states the table shows. The 60-day window is the owner's decision for this
// page only; warnings.ts keeps its 90/60/30 bands.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  appointmentCellStatus,
  appointmentFootprint,
  cellDialogDefaults,
  compactMoney,
  currentCeRecord,
  dayMonth,
  latestAppointmentByCell,
  licenceStatus,
  readinessItems,
  readinessSummary,
} from "./readiness.ts";
import { appointmentCountsForRouting, appointmentIsActiveAt, canWriteFromVault } from "./eligibility.ts";
import { US_REGIONS, STATE_CODES, compareByRegion } from "./constants.ts";
import { appointmentRowSchema } from "./schemas.ts";

const TODAY = "2026-09-24";
const row = (over = {}) => ({
  id: "a1", tenant_id: "t", carrier_id: "cardinal", state: "GA", status: "active",
  effective_from: "2025-01-01", terminated_at: null, expires_at: null, created_at: "2025-01-01T00:00:00Z", updated_at: "", ...over,
});

test("a cell reads its latest row: effective date first, then creation time", () => {
  const latest = latestAppointmentByCell([
    row({ id: "old", effective_from: "2024-01-01" }),
    row({ id: "new", effective_from: "2025-06-01" }),
    row({ id: "same-early", carrier_id: "mutual", effective_from: "2025-01-01", created_at: "2025-01-01T00:00:00Z" }),
    row({ id: "same-late", carrier_id: "mutual", effective_from: "2025-01-01", created_at: "2025-02-01T00:00:00Z" }),
  ]);
  assert.equal(latest.get("cardinal:GA").id, "new");
  assert.equal(latest.get("mutual:GA").id, "same-late");
});

test("every cell state the board shows, and nothing routes that should not", () => {
  const cases = [
    [undefined, "none", false],
    [row(), "appointed", true],
    [row({ expires_at: "2026-11-01" }), "expiring", true],
    [row({ expires_at: "2027-06-01" }), "appointed", true],
    [row({ status: "pending" }), "pending", false],
    [row({ expires_at: "2026-09-04" }), "expired", false],
    [row({ status: "terminated", terminated_at: "2026-01-01" }), "ended", false],
    [row({ terminated_at: "2026-09-01" }), "ended", false],
    [row({ effective_from: "2026-10-01" }), "starts", false],
  ];
  for (const [input, kind, routes] of cases) {
    assert.equal(appointmentCellStatus(input, TODAY).kind, kind, JSON.stringify(input));
    if (input) {
      assert.equal(appointmentCountsForRouting(input, TODAY), routes, `routing for ${kind}`);
      assert.equal(appointmentIsActiveAt(input, TODAY), routes, `active-at for ${kind}`);
    }
  }
  // Expires today still counts; yesterday does not.
  assert.equal(appointmentCountsForRouting(row({ expires_at: TODAY }), TODAY), true);
  assert.equal(appointmentCountsForRouting(row({ expires_at: "2026-09-23" }), TODAY), false);
});

test("canWrite refuses pending and expired appointments, and keeps the pre-termination rule", () => {
  const vault = {
    tenantCarriers: [{ carrier_id: "cardinal", effective_from: "2024-01-01" }],
    appointments: [row()],
    licenses: [{ state: "GA", license_number: "GA-1", expires_at: "2030-01-01" }],
    eoPolicies: [{ carrier: "EO", policy_number: "1", expires_at: "2030-01-01" }],
  };
  assert.equal(canWriteFromVault(vault, "cardinal", "GA", TODAY), true);
  assert.equal(canWriteFromVault({ ...vault, appointments: [row({ status: "pending" })] }, "cardinal", "GA", TODAY), false);
  assert.equal(canWriteFromVault({ ...vault, appointments: [row({ expires_at: "2026-09-04" })] }, "cardinal", "GA", TODAY), false);
  assert.equal(canWriteFromVault({ ...vault, appointments: [row({ expires_at: "2026-09-04" })] }, "cardinal", "GA", "2026-09-01"), true);
});

test("the footprint is every state with an appointment row or a licence, in Census-region order", () => {
  const states = appointmentFootprint(
    [row({ state: "TX" }), row({ state: "NY" }), row({ state: "CA" }), row({ state: "TX" })],
    [{ state: "IL" }, { state: "FL" }],
  );
  assert.deepEqual(states, ["NY", "IL", "FL", "TX", "CA"]);
  assert.ok(compareByRegion("NY", "IL") < 0 && compareByRegion("IL", "FL") < 0 && compareByRegion("TX", "CA") < 0);
});

test("the regions cover each of the 51 codes exactly once", () => {
  const listed = US_REGIONS.flatMap((region) => region.states);
  assert.equal(listed.length, 51);
  assert.deepEqual([...listed].sort(), [...STATE_CODES].sort());
});

test("licence status on the page's 60-day window", () => {
  assert.deepEqual(licenceStatus("2026-11-03", TODAY), { tone: "warning", label: "40 days" });
  assert.deepEqual(licenceStatus("2026-11-23", TODAY), { tone: "warning", label: "60 days" });
  assert.deepEqual(licenceStatus("2026-11-24", TODAY), { tone: "success", label: "Current" });
  assert.deepEqual(licenceStatus("2026-09-23", TODAY), { tone: "error", label: "Expired" });
});

const carriers = [{ id: "cardinal", name: "Cardinal Life" }, { id: "mutual", name: "Mutual Standard" }];
const tenantCarriers = [{ carrier_id: "cardinal", is_active: true }, { carrier_id: "mutual", is_active: true }];
const eo = { id: "eo", tenant_id: "t", carrier: "Beacon Specialty", policy_number: "B-1", expires_at: "2026-10-16", coverage_amount_cents: 100_000_000, per_claim_cents: 100_000_000, aggregate_cents: 300_000_000, created_at: "", updated_at: "" };
const licence = (state, expires_at) => ({ id: `l-${state}`, tenant_id: "t", state, license_number: `${state}-1`, expires_at, created_at: "", updated_at: "" });

test("readiness: blockers first, then warnings soonest first, in the board's words", () => {
  const items = readinessItems({
    carriers,
    tenantCarriers,
    appointments: [
      row({ id: "ga", expires_at: "2026-09-04" }),
      row({ id: "tx", state: "TX", expires_at: "2026-11-15" }),
    ],
    licenses: [licence("GA", "2030-01-01"), licence("TX", "2026-11-02")],
    eoPolicies: [eo],
    ceRecords: [],
    carrierTrainings: [
      { id: "t1", tenant_id: "t", carrier_id: "mutual", title: "AML refresher", due_on: "2026-10-10", completed_on: null, updated_at: "", updated_by: null },
      { id: "t2", tenant_id: "t", carrier_id: "mutual", title: "Done already", due_on: "2026-10-01", completed_on: "2026-09-01", updated_at: "", updated_by: null },
    ],
  }, TODAY);
  assert.deepEqual(items.map((item) => [item.tone, item.title, item.body]), [
    ["error", "Expired — cannot sell", "Cardinal Life in Georgia expired 4 Sep. It no longer counts toward routing Georgia leads."],
    ["warning", "Training due in 16 days", "Mutual Standard: AML refresher, 10 Oct 2026."],
    ["warning", "E&O expires in 22 days", "$1M / $3M, Beacon Specialty, 16 Oct 2026."],
    ["warning", "Expires in 39 days", "State licence: Texas, 2 Nov 2026."],
    ["warning", "Expires in 52 days", "Appointment: Cardinal Life in Texas, 15 Nov 2026."],
  ]);
  assert.deepEqual(readinessSummary(items), { tone: "error", label: "1 blocker", blockers: 1 });
});

test("an expired appointment names the carrier that still routes the state", () => {
  const items = readinessItems({
    carriers, tenantCarriers,
    appointments: [row({ id: "ga", expires_at: "2026-09-04" }), row({ id: "ga2", carrier_id: "mutual" })],
    licenses: [licence("GA", "2030-01-01")], eoPolicies: [{ ...eo, expires_at: "2030-01-01" }], ceRecords: [], carrierTrainings: [],
  }, TODAY);
  assert.equal(items[0].body, "Cardinal Life in Georgia expired 4 Sep. Georgia leads still route through Mutual Standard.");
});

test("a missing or expired licence where the agency is appointed blocks, and no E&O blocks", () => {
  const items = readinessItems({
    carriers, tenantCarriers,
    appointments: [row({ state: "FL" }), row({ id: "ny", state: "NY", carrier_id: "mutual" })],
    licenses: [licence("NY", "2026-08-28"), licence("OH", "2026-01-01")],
    eoPolicies: [], ceRecords: [], carrierTrainings: null,
    carrierRequirements: [{ carrier_id: "mutual", requires_eo: true }],
  }, TODAY);
  const errors = items.filter((item) => item.tone === "error").map((item) => item.body);
  assert.deepEqual(errors.sort(), [
    "Appointed in Florida, but no state licence is on file. Florida leads cannot be assigned.",
    "No errors & omissions policy is on file. 1 carrier appointment requires it.",
    "State licence: New York expired 28 Aug. New York leads cannot be assigned until it is renewed.",
  ]);
  // Ohio's licence expired, but nothing is appointed there, so it blocks nothing.
  assert.ok(!items.some((item) => item.body.includes("Ohio")));
});

test("states missing a licence share one card, and the pill still counts each state", () => {
  const items = readinessItems({
    carriers, tenantCarriers,
    appointments: [row({ id: "fl", state: "FL" }), row({ id: "tx", state: "TX" }), row({ id: "il", state: "IL" })],
    licenses: [],
    eoPolicies: [{ id: "eo", carrier: "Beacon", policy_number: "P1", expires_at: "2027-06-01", coverage_amount_cents: 100000000, per_claim_cents: null, aggregate_cents: null }],
    ceRecords: [], carrierTrainings: null, carrierRequirements: null,
  }, TODAY);
  const missing = items.filter((item) => item.key === "licence-missing");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].title, "Not licensed in 3 states — cannot sell");
  assert.equal(missing[0].count, 3);
  assert.match(missing[0].body, /Illinois/);
  assert.match(missing[0].body, /Texas/);
  assert.match(missing[0].body, /Florida/);
  assert.equal(readinessSummary(items).label, "3 blockers");
});

test("pill: nothing due, N expiring, N blockers", () => {
  assert.deepEqual(readinessSummary([]), { tone: "success", label: "Nothing due", blockers: 0 });
  assert.equal(readinessSummary([{ tone: "warning" }, { tone: "warning" }]).label, "2 expiring");
  assert.equal(readinessSummary([{ tone: "error" }, { tone: "error" }, { tone: "warning" }]).label, "2 blockers");
});

test("formatting helpers", () => {
  assert.equal(dayMonth("2026-09-04"), "4 Sep 2026");
  assert.equal(dayMonth("2026-09-04", false), "4 Sep");
  assert.equal(compactMoney(100_000_000), "$1M");
  assert.equal(compactMoney(150_000_000), "$1.5M");
  assert.equal(compactMoney(25_000_000), "$250K");
  assert.equal(currentCeRecord([{ deadline: "2026-01-01" }, { deadline: "2026-12-31" }, { deadline: "2027-12-31" }], TODAY).deadline, "2026-12-31");
});

test("an appointment cannot expire before it takes effect", () => {
  const base = { carrier_id: "00000000-0000-4000-8000-000000000001", state: "GA", status: "pending", effective_from: "2026-10-01" };
  assert.equal(appointmentRowSchema.safeParse(base).success, true);
  assert.equal(appointmentRowSchema.safeParse({ ...base, expires_at: "2026-09-30" }).success, false);
  assert.equal(appointmentRowSchema.safeParse({ ...base, expires_at: "2027-09-30" }).success, true);
});

test("the SQL gate and its explanation know about expiry and pending", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260924310000_carrier_appointment_status_and_expiry.sql", import.meta.url), "utf8");
  const gate = sql.slice(sql.indexOf("create or replace function public.assignment_candidate_is_eligible"), sql.indexOf("create or replace function public.assignment_ineligibility_reason"));
  assert.match(gate, /a\.status = 'active'/);
  assert.match(gate, /a\.expires_at is null or a\.expires_at >= current_date/);
  assert.match(sql, /has expired, so nothing can be written there/);
  assert.match(sql, /still pending with the carrier/);
  assert.match(sql, /check \(status in \('pending', 'active', 'terminated'\)\)/);
  assert.match(sql, /grant execute on function public\.assignment_candidate_is_eligible\(uuid, uuid, text, text, text, boolean\)\s+to service_role/);
});

test("the cell dialog opens on what the table shows", () => {
  assert.deepEqual(cellDialogDefaults(undefined, TODAY), { status: "active", effective_from: TODAY, expires_at: "", terminated_at: TODAY });
  assert.equal(cellDialogDefaults(row({ terminated_at: "2026-09-01" }), TODAY).status, "terminated");
  assert.equal(cellDialogDefaults(row({ status: "pending" }), TODAY).status, "pending");
  assert.equal(cellDialogDefaults(row({ expires_at: "2027-01-01" }), TODAY).expires_at, "2027-01-01");
});
