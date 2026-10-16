// LA-6.4 (Notion sprint, Module 6 — Compliance) · complaint handling.
// Run with: node --experimental-strip-types --test lib/compliance/complaints.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { countdown, deadlineCoverage, sortComplaints, COMPLAINT_CHANNELS, DEADLINE_CHANNELS } from "./complaints.ts";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261015130000_la_6_4_complaints.sql";
const NOW = new Date("2026-10-15T12:00:00Z");
const due = (days) => new Date(NOW.getTime() + days * 86_400_000).toISOString();
const doi = (extra = {}) => ({ channel: "doi", status: "open", responseDueAt: due(20), respondedAt: null, ...extra });

test("all five channels exist; only DOI and FTC carry a deadline", () => {
  assert.deepEqual([...COMPLAINT_CHANNELS], ["agent", "carrier", "doi", "ftc", "other"]);
  assert.deepEqual([...DEADLINE_CHANNELS], ["doi", "ftc"]);
  assert.match(read(MIGRATION), /if v_channel in \('doi', 'ftc'\) then/);
});

test("the countdown: calm, amber at 10, red at 5 (pinned), overdue loudest", () => {
  assert.equal(countdown(doi({ responseDueAt: due(20) }), NOW).tone, "calm");
  assert.equal(countdown(doi({ responseDueAt: due(10) }), NOW).tone, "amber");
  const red = countdown(doi({ responseDueAt: due(5) }), NOW);
  assert.equal(red.tone, "red");
  assert.equal(red.pinned, true);
  assert.equal(red.label, "Respond within 5 days");
  const late = countdown(doi({ responseDueAt: due(-2) }), NOW);
  assert.equal(late.tone, "overdue");
  assert.equal(late.label, "Overdue by 2 days");
  assert.equal(late.pinned, true);
  // Thresholds come from the tenant's settings, not code.
  assert.equal(countdown(doi({ responseDueAt: due(12) }), NOW, { amberDays: 14, redDays: 7 }).tone, "amber");
});

test("no configured deadline is a prompt, never a guessed default", () => {
  const c = countdown(doi({ responseDueAt: null }), NOW);
  assert.equal(c.tone, "no_deadline");
  assert.match(c.label, /No deadline set/);
  const sql = read(MIGRATION);
  assert.match(sql, /select d\.response_days into v_days from public\.compliance_complaint_deadline d/);
  assert.match(sql, /if v_days is not null then\n\s+v_due := v_received \+ make_interval\(days => v_days\);/);
  assert.doesNotMatch(sql, /coalesce\(v_days|v_days := \d|default \d+ days/i);
  assert.match(sql, /a deadline was invented for a regulator with none configured/);
  // An agent complaint has no statutory deadline at all.
  assert.equal(countdown({ channel: "agent", status: "open", responseDueAt: null, respondedAt: null }, NOW).tone, "none");
});

test("days remaining is the primary sort; overdue first; resolved last", () => {
  const rows = [
    { id: "calm", status: "open", receivedAt: "2026-10-01", countdown: countdown(doi({ responseDueAt: due(25) }), NOW) },
    { id: "resolved", status: "resolved", receivedAt: "2026-10-10", countdown: countdown(doi({ status: "resolved", responseDueAt: due(-9) }), NOW) },
    { id: "red", status: "open", receivedAt: "2026-10-02", countdown: countdown(doi({ responseDueAt: due(3) }), NOW) },
    { id: "late", status: "open", receivedAt: "2026-09-01", countdown: countdown(doi({ responseDueAt: due(-1) }), NOW) },
    { id: "amber", status: "open", receivedAt: "2026-10-03", countdown: countdown(doi({ responseDueAt: due(8) }), NOW) },
  ];
  assert.deepEqual(sortComplaints(rows).map((r) => r.id), ["late", "red", "amber", "calm", "resolved"]);
});

test("an unwanted-calls complaint reaches the do-not-call list in the same transaction, through LA-2.3", () => {
  const sql = read(MIGRATION);
  const fn = sql.slice(sql.indexOf("create or replace function public.open_complaint"), sql.indexOf("revoke all on function public.open_complaint"));
  assert.match(fn, /if p->>'category' = 'unwanted_calls' then\n\s+v_dnc := public\.suppress_phone\(p_tenant_id, v_phone, 'internal', 'Complaint ' \|\| v_id \|\| ': asked not to be called', 'complaint', p_actor\);/);
  assert.match(fn, /update public\.complaint set dnc_entry_id = v_dnc, dnc_added_at = now\(\) where id = v_id;/);
  assert.match(sql, /constraint complaint_calls_need_number check \(category <> 'unwanted_calls' or phone_digits is not null\)/);
  // The app opens complaints only through that function.
  assert.match(read("lib/compliance/complaintStore.ts"), /rpc\("open_complaint"/);
  assert.doesNotMatch(read("lib/compliance/complaintStore.ts"), /from\("complaint"\)\.insert|tenant_do_not_call/);
});

test("the owner is never null: an unknown owner falls back to the tenant admin", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /owner_user_id uuid not null references public\.users\(id\)/);
  assert.match(sql, /v_owner := coalesce\(v_owner, public\.tenant_owner_user\(p_tenant_id\)\);/);
});

test("the evidence report is attached on creation", () => {
  const store = read("lib/compliance/complaintStore.ts");
  const open = store.slice(store.indexOf("export async function openComplaint"), store.indexOf("async function appendAttachment"));
  assert.match(open, /buildEvidenceReport\(viewer, \{ type: "phone", phone: phoneDigits \}/);
  assert.match(open, /kind: "evidence_report"/);
});

test("no AI writes a regulator response", () => {
  for (const f of ["lib/compliance/complaintStore.ts", "lib/compliance/complaints.ts", "components/app/compliance/complaints-board.tsx", "app/api/app/compliance/complaints/[id]/route.ts"]) {
    assert.doesNotMatch(read(f), /from "[^"]*(anthropic|openai|\/ai\/|aiAssistant|ai-assistant)[^"]*"|generateText\(|draftResponse/i, f);
  }
});

test("an overdue regulator complaint is a banner on every page that cannot be dismissed", () => {
  const layout = read("app/app/(shell)/layout.tsx");
  assert.match(layout, /overdueRegulatorComplaintCount\(session\.tenantId\)/);
  assert.ok(layout.indexOf("<OverdueComplaintBanner") < layout.indexOf("<MaintenanceMessage"), "louder than every other banner");
  const banner = read("components/app/overdue-complaint-banner.tsx");
  assert.doesNotMatch(banner, /onClick|onDismiss|useState|localStorage|"use client"/);
  assert.match(banner, /role="alert"/);
});

test("complaints count against the partner that supplied the lead", () => {
  assert.match(read("lib/partnerQuality/detail.ts"), /complaintsByPartner\(tenantId, from, to, partnerId\)/);
  assert.match(read("components/app/partner-quality-detail.tsx"), /label: "Complaints", value: data\.gate\.current\.complaints/);
  assert.match(read("lib/compliance/complaintStore.ts"), /partner_id: input\.partnerId \?\? found\.partnerId/);
});

test("what was received never changes, and complaints are never deleted", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /revoke delete, truncate on public\.complaint from service_role;/);
  assert.match(sql, /raise exception 'complaint: what was received, and when, cannot change'/);
});

test("the deadline email goes daily inside the red window, deduplicated per person per day", () => {
  const digest = read("lib/compliance/complaintDigest.ts");
  assert.match(digest, /if \(!cd\.pinned\) continue;/);
  assert.match(digest, /const dedupeKey = `complaint-deadline-\$\{c\.id\}-\$\{day\}-\$\{person\.id\}`;/);
  assert.match(read("app/api/cron/complaint-deadlines/route.ts"), /request\.headers\.get\("authorization"\) !== `Bearer \$\{secret\}`/);
});

test("deadline coverage over the licensed states", () => {
  const c = deadlineCoverage(["TX", "FL", "GA", "tx"], ["TX", "FTC"]);
  assert.equal(c.sentence, "Deadlines configured for 1 of 3 licensed states. Complaints from the other 2 will have no countdown.");
  assert.deepEqual(c.missing, ["FL", "GA"]);
  assert.equal(c.ftc, true);
});

test("owner and producer only; setting a regulator's days is the owner's", () => {
  const dir = "app/api/app/compliance/complaints";
  const files = [`${dir}/route.ts`, `${dir}/[id]/route.ts`, `${dir}/[id]/attachments/route.ts`];
  for (const f of files) assert.deepEqual(AGENT_API_POLICIES.find((p) => p.sourceFile === f)?.allowedRoles, ["owner", "producer"], f);
  assert.deepEqual(AGENT_API_POLICIES.find((p) => p.sourceFile === `${dir}/[id]/deadline/route.ts`)?.allowedRoles, ["owner"]);
  assert.ok(readdirSync(join(root, dir)).includes("route.ts"));
});
