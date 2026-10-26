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

test("terminated, past-dated or expired rows do not count as appointed; pending does", () => {
  assert.equal(M.isOpenAppointment(row({ status: "terminated", terminated_at: "2026-02-01" }), TODAY), false);
  assert.equal(M.isOpenAppointment(row({ terminated_at: "2026-10-01" }), TODAY), false);
  assert.equal(M.isOpenAppointment(row({ expires_at: "2026-10-25" }), TODAY), false);
  assert.equal(M.isOpenAppointment(row({ status: "pending" }), TODAY), true);
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
