// Run with: node --experimental-strip-types --test lib/audit/entryView.test.mjs
//
// The Audit log's read-side pieces (admin round 1, monitoring.html screen 5): the before/after table, target links,
// the list's short time, the CSV export and the lenses.
import test from "node:test";
import assert from "node:assert/strict";

import { auditCsv, auditDiff, auditTargetHref, formatAuditValue, humanizeKey, shortWhenUtc } from "./entryView.ts";
import { auditLensActions, inAuditLens, isAuditLens } from "./lenses.ts";
import { auditQueryString, parseAuditLogFilters } from "./logView.ts";

test("changes written as { field: { from, to } } become before/after rows", () => {
  const { changes, facts } = auditDiff({ changes: { state: { from: "on", to: "off" }, betaTenants: { from: 0, to: 2 } }, feature_key: "ai" });
  assert.deepEqual(changes, [
    { field: "State", before: "on", after: "off" },
    { field: "Beta tenants", before: "0", after: "2" },
  ]);
  assert.deepEqual(facts, [{ field: "Feature key", value: "ai" }]);
});

test("changes beside a before object pair up, and unchanged before values are kept as facts", () => {
  const { changes, facts } = auditDiff({ email: "a@b.c", changes: { role: "support_agent" }, before: { role: "super_admin", is_active: true } });
  assert.deepEqual(changes, [{ field: "Role", before: "super_admin", after: "support_agent" }]);
  assert.ok(facts.some((f) => f.field === "Is active (unchanged)" && f.value === "Yes"));
  assert.ok(facts.some((f) => f.field === "Email" && f.value === "a@b.c"));
});

test("before and after objects side by side, and inline { before, after } fields", () => {
  assert.deepEqual(auditDiff({ before: { name: "A" }, after: { name: "B", sort_order: 2 } }).changes, [
    { field: "Name", before: "A", after: "B" },
    { field: "Sort order", before: "—", after: "2" },
  ]);
  const inline = auditDiff({ name: "Acme", phone: { before: null, after: "555" }, from: "carrier_record" });
  assert.deepEqual(inline.changes, [{ field: "Phone", before: "—", after: "555" }]);
  assert.deepEqual(inline.facts.map((f) => f.field), ["Name", "From"]);
});

test("anything else is listed key by key, and empty metadata gives nothing", () => {
  assert.deepEqual(auditDiff({}), { changes: [], facts: [] });
  assert.deepEqual(auditDiff(null), { changes: [], facts: [] });
  assert.deepEqual(auditDiff({ count: 3, ids: ["a", "b"] }).facts, [{ field: "Count", value: "3" }, { field: "IDs", value: "a, b" }]);
  assert.equal(formatAuditValue(false), "No");
  assert.equal(formatAuditValue({ a: 1 }), '{"a":1}');
  assert.equal(humanizeKey("totp_enrolled"), "TOTP enrolled");
});

test("a target links to its own admin page", () => {
  assert.equal(auditTargetHref("tenant", "t1"), "/admin/tenants/t1");
  assert.equal(auditTargetHref("invoice", "i 1"), "/admin/invoices/i%201");
  assert.equal(auditTargetHref("plan", "p1"), "/admin/plans/p1/edit");
  assert.equal(auditTargetHref("carrier", "c1"), "/admin/carriers");
  assert.equal(auditTargetHref("cron_job", "/api/cron/webhooks"), "/admin/monitoring/jobs");
  assert.equal(auditTargetHref("mystery", "x"), null);
  assert.equal(auditTargetHref(null, "x"), null);
});

test("the list's time is short, in UTC", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  assert.equal(shortWhenUtc("2026-11-17T10:42:10Z", now), "Today 10:42");
  assert.equal(shortWhenUtc("2026-11-16T09:15:00Z", now), "Yesterday 09:15");
  assert.equal(shortWhenUtc("2026-11-03T08:05:00Z", now), "3 Nov 08:05");
  assert.equal(shortWhenUtc("2025-12-31T23:00:00Z", now), "31 Dec 2025");
});

test("the CSV goes through the shared guard", () => {
  const csv = auditCsv([{
    id: "1", ts: "2026-11-17T10:42:10Z", whenUtc: "17 Nov 2026 10:42:10 UTC", actor_type: "admin", actor_id: "a", actorLabel: "qa@x", actorDetail: "QA (qa@x)",
    action: "feature.updated", actionLabel: "Feature updated", target_type: "feature", target_id: "f", targetLabel: null, reason: "=HYPERLINK(1)", ip: null, user_agent: null, metadata: { a: 1 },
  }]);
  const [header, row] = csv.trim().split("\r\n");
  assert.ok(header.startsWith('"When (UTC)","Timestamp","Who"'));
  assert.ok(row.includes(`"'=HYPERLINK(1)"`));
  assert.ok(row.includes(`"{""a"":1}"`));
});

test("lenses hold the right families and live in the address", () => {
  assert.ok(inAuditLens("money", "invoice.voided"));
  assert.ok(inAuditLens("money", "billing.waiver_granted"));
  assert.ok(inAuditLens("access", "admin.sessions_ended"));
  assert.ok(inAuditLens("access", "security.login_unlocked"));
  assert.ok(inAuditLens("catalog", "layout_map.published"));
  assert.ok(!inAuditLens("catalog", "carrier_agent.saved"));
  assert.ok(!inAuditLens("access", "tenant.created"));
  assert.equal(auditLensActions("all", ["a.b"]), null);
  assert.deepEqual(auditLensActions("catalog", ["plan.created", "tenant.created"]), ["plan.created"]);
  assert.ok(isAuditLens("money") && !isAuditLens("everything"));

  const f = parseAuditLogFilters(new URLSearchParams({ lens: "catalog", target: "abc", page: "2", actorType: "system" }), []);
  assert.equal(f.lens, "catalog");
  assert.equal(parseAuditLogFilters(new URLSearchParams({ lens: "nope" }), []).lens, "all");
  assert.equal(auditQueryString(f, true), "lens=catalog&actorType=system&target=abc&page=2");
  // Anyone but a super admin never sends an actor filter, and the address leaves the page out.
  assert.equal(auditQueryString(f, false, false), "lens=catalog&target=abc");
});
