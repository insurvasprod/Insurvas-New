import { test } from "node:test";
import assert from "node:assert/strict";

const M = await import("./tickModel.ts");

const row = (over) => ({ id: "a1", tenant_id: "t", carrier_id: "c1", state: "AR", status: "active", effective_from: "2026-01-01", terminated_at: null, expires_at: null, created_at: "", updated_at: "", ...over });
const TODAY = "2026-10-26";

test("ticking a carrier on in a state with nothing on file starts a new active row today", () => {
  assert.deepEqual(M.appointmentChange([], "c1", "AR", true, TODAY), [{ carrier_id: "c1", state: "AR", status: "active", effective_from: TODAY }]);
});

test("ticking on when already appointed saves nothing", () => {
  assert.deepEqual(M.appointmentChange([row()], "c1", "AR", true, TODAY), []);
});

test("ticking off ends the open row today and keeps its start date (never deletes)", () => {
  assert.deepEqual(M.appointmentChange([row()], "c1", "AR", false, TODAY), [{ id: "a1", carrier_id: "c1", state: "AR", status: "terminated", effective_from: "2026-01-01", terminated_at: TODAY }]);
});

test("ticking back on the same day reopens that day's row instead of colliding with it", () => {
  const ended = row({ id: "a2", effective_from: TODAY, status: "terminated", terminated_at: TODAY });
  assert.deepEqual(M.appointmentChange([ended], "c1", "AR", true, TODAY), [{ id: "a2", carrier_id: "c1", state: "AR", status: "active", effective_from: TODAY, terminated_at: null }]);
});

test("terminated, past-dated or expired rows are closed; a pending one stays open (still ticked)", () => {
  assert.equal(M.isOpenAppointment(row({ status: "terminated", terminated_at: "2026-02-01" }), TODAY), false);
  assert.equal(M.isOpenAppointment(row({ terminated_at: "2026-10-01" }), TODAY), false);
  assert.equal(M.isOpenAppointment(row({ expires_at: "2026-10-25" }), TODAY), false);
  assert.equal(M.isOpenAppointment(row({ status: "pending" }), TODAY), true);
});

test("a pending appointment never makes a carrier appointed (Settings agrees with eligibility.ts)", () => {
  const rows = [row({ state: "AR" }), row({ id: "p1", state: "TX", status: "pending" }), row({ id: "p2", state: "AR", status: "pending" }), row({ id: "x", state: "OK", status: "pending", terminated_at: "2026-10-01" })];
  assert.equal(M.isActiveAppointment(row({ status: "pending" }), TODAY), false);
  assert.equal(M.isActiveAppointment(row(), TODAY), true);
  assert.equal(M.isActiveAppointment(row({ expires_at: "2026-10-25" }), TODAY), false);
  assert.deepEqual(M.appointedStatesFor(rows, "c1", TODAY), ["AR"]);
  // TX is only applied for; AR is pending again but already appointed, so it is not "pending"; OK ended.
  assert.deepEqual(M.pendingStatesFor(rows, "c1", TODAY), ["TX"]);
  // The States step still ticks what was applied for.
  assert.deepEqual(M.statesFor(rows, "c1", TODAY), ["AR", "TX"]);
  // Only pending: nothing to sell in.
  assert.deepEqual(M.appointedStatesFor([row({ status: "pending" })], "c1", TODAY), []);
});

test("Carriers reads readiness from appointed states, not ticked ones", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../../components/app/settings/carriers-settings.tsx", import.meta.url), "utf8");
  assert.match(page, /const progressOf = \(carrierId: string\) => carrierProgress\([^;]*appointedStatesFor\([^;]*pendingStatesFor\(/);
  assert.match(page, /states=\{appointedStatesFor\(vault\.appointments, current\.id, today\)\}/);
  assert.doesNotMatch(page, /carrierProgress\([^)]*statesFor\(vault/);
});

test("a tick shows at once: changes applied locally match what the save will hold", () => {
  const rows = [row()];
  const on = M.appointmentChange(rows, "c1", "TX", true, TODAY);
  const after = M.applyAppointmentChanges(rows, on, TODAY);
  assert.deepEqual(M.statesFor(after, "c1", TODAY), ["AR", "TX"]);
  const off = M.appointmentChange(after, "c1", "AR", false, TODAY);
  assert.deepEqual(M.statesFor(M.applyAppointmentChanges(after, off, TODAY), "c1", TODAY), ["TX"], "an untick ends the row today");
  assert.equal(rows.length, 1, "the input is not changed");
});

test("coverage over several states reads all, some or none", () => {
  const rows = [row({ state: "AR" }), row({ id: "b", state: "TX" })];
  assert.equal(M.coverage(rows, "c1", ["AR", "TX"], TODAY), "all");
  assert.equal(M.coverage(rows, "c1", ["AR", "OK"], TODAY), "some");
  assert.equal(M.coverage(rows, "c2", ["AR", "OK"], TODAY), "none");
});

test("licence status: active, renew inside 60 days, expired", () => {
  assert.equal(M.licenceStatus({ expires_at: "2027-06-01" }, TODAY).label, "Active");
  assert.equal(M.licenceStatus({ expires_at: "2026-11-20" }, TODAY).label, "Renew in 25 days");
  assert.equal(M.licenceStatus({ expires_at: "2026-10-01" }, TODAY).tone, "danger");
  assert.equal(M.licenceStatus(null, TODAY), null);
});

test("contract level reads as carriers quote it and stores basis points", () => {
  assert.equal(M.levelToBp("110"), 11000);
  assert.equal(M.levelToBp("105.5%"), 10550);
  assert.equal(M.levelToBp("abc"), null);
  assert.equal(M.bpToLevel(10550), "105.5");
});

test("a row made on screen is saved without its local id, so the server matches it by carrier, state and date", async () => {
  const { forServer } = await import("./tickModel.ts");
  const changes = [
    { id: "local-c1-TX-3", carrier_id: "c1", state: "TX", status: "terminated", effective_from: "2026-10-29", terminated_at: "2026-10-29" },
    { id: "8f7c2a1e-0000-4000-8000-000000000001", carrier_id: "c1", state: "FL", status: "active", effective_from: "2026-10-01" },
  ];
  const sent = forServer(changes);
  assert.equal(sent[0].id, undefined);
  assert.equal(sent[0].state, "TX");
  assert.equal(sent[1].id, "8f7c2a1e-0000-4000-8000-000000000001");
});
