import test from "node:test";
import assert from "node:assert/strict";
import { buildAlertCentre } from "./centre.ts";

const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";
const L3 = "33333333-3333-4333-8333-333333333333";
const AGENT = "99999999-9999-4999-8999-999999999999";

const row = (id, kind, lead, at) => ({ id, kind, title: `${kind} ${id}`, body: "b", link: lead ? `/app/leads/${lead}` : "/app/inbound", created_at: at });
const queue = (id, lead, status, at, extra = {}) => ({ id, lead_id: lead, status, claimed_by: null, claimed_at: null, queued_at: at, ...extra });

test("a lead still unclaimed is open; one claimed is resolved, and says by whom", () => {
  const { open, resolved } = buildAlertCentre(
    [row("n1", "new_unclaimed_lead", L1, "2026-09-24T10:00:00Z"), row("n2", "new_unclaimed_lead", L2, "2026-09-24T10:05:00Z")],
    [queue("q1", L1, "unclaimed", "2026-09-24T09:59:00Z"), queue("q2", L2, "claimed", "2026-09-24T10:04:00Z", { claimed_by: AGENT, claimed_at: "2026-09-24T10:07:00Z" })],
    new Map([[AGENT, "Priya Raman"]]),
  );
  assert.deepEqual(open.map((e) => [e.leadId, e.workItemId]), [[L1, "q1"]]);
  assert.equal(resolved[0].resolution, "Claimed by Priya Raman");
  assert.equal(resolved[0].resolvedAt, "2026-09-24T10:07:00Z");
});

test("an escalated lead is one critical entry, raised when it was first announced", () => {
  const { open } = buildAlertCentre(
    [row("n1", "new_unclaimed_lead", L1, "2026-09-24T10:00:00Z"), row("n2", "unclaimed_sla_escalation", L1, "2026-09-24T10:02:00Z")],
    [queue("q1", L1, "unclaimed", "2026-09-24T09:59:00Z")],
    new Map(),
  );
  assert.equal(open.length, 1);
  assert.equal(open[0].severity, "critical");
  assert.equal(open[0].title, "unclaimed_sla_escalation n2");
  assert.equal(open[0].raisedAt, "2026-09-24T10:00:00Z");
});

test("the latest queue row decides, not the first", () => {
  const { open, resolved } = buildAlertCentre(
    [row("n1", "new_unclaimed_lead", L1, "2026-09-24T10:00:00Z")],
    [queue("old", L1, "claimed", "2026-09-20T09:00:00Z"), queue("new", L1, "unclaimed", "2026-09-24T09:59:00Z")],
    new Map(),
  );
  assert.equal(open.length, 1);
  assert.equal(resolved.length, 0);
  assert.equal(open[0].workItemId, "new");
});

test("expired and missing queue rows are resolved, and say so plainly", () => {
  const { resolved } = buildAlertCentre(
    [row("n1", "new_unclaimed_lead", L1, "2026-09-24T10:00:00Z"), row("n2", "new_unclaimed_lead", L2, "2026-09-24T11:00:00Z")],
    [queue("q1", L1, "expired", "2026-09-24T09:59:00Z")],
    new Map(),
  );
  assert.deepEqual(resolved.map((e) => e.resolution).sort(), ["Expired before anybody claimed it", "No longer in the queue"]);
});

test("personal notifications and rows without a lead are not workspace alerts", () => {
  const { open, resolved } = buildAlertCentre(
    [row("n1", "handoff_offered", L1, "2026-09-24T10:00:00Z"), row("n2", "new_unclaimed_lead", null, "2026-09-24T10:00:00Z")],
    [queue("q1", L1, "unclaimed", "2026-09-24T09:59:00Z")],
    new Map(),
  );
  assert.equal(open.length + resolved.length, 0);
});

test("open alerts put critical first, then whatever has waited longest", () => {
  const { open } = buildAlertCentre(
    [row("a", "new_unclaimed_lead", L1, "2026-09-24T09:00:00Z"), row("b", "unclaimed_sla_escalation", L2, "2026-09-24T10:00:00Z"), row("c", "new_unclaimed_lead", L3, "2026-09-24T08:00:00Z")],
    [queue("q1", L1, "unclaimed", "2026-09-24T09:00:00Z"), queue("q2", L2, "unclaimed", "2026-09-24T09:00:00Z"), queue("q3", L3, "unclaimed", "2026-09-24T08:00:00Z")],
    new Map(),
  );
  assert.deepEqual(open.map((e) => e.leadId), [L2, L3, L1]);
});
