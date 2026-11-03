// LA-6 audit (Notion sprint, Module 6 — Compliance) · the legal-risk fixes of 20261015630000 and the
// code around them. Behaviour against a database is proven by the rolled-back rehearsal; this holds the
// TypeScript twin of the consent rule to the SQL corpus and pins the wiring.
// Run with: node --experimental-strip-types --test lib/compliance/legalRiskFixes.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { consentValidAt } from "./consentValidity.ts";
import { dashboardAlerts } from "./dashboardCore.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261015630000_la_6_legal_risk_fixes.sql";
const CLAIM = { trustedform: 72, jornaya: null, other: null };
const art = (capture_status, consent_timestamp, captured_at, provider = "trustedform") => ({ capture_status, provider, consent_timestamp, captured_at });

test("one consent rule: the TypeScript twin answers the SQL self-check's corpus", () => {
  // Same six cases, same answers, as the self-check of compliance_consent_valid_at.
  assert.equal(consentValidAt(art("claimed", "2026-01-01T10:00Z", "2026-01-01T10:05Z"), "2026-01-01T09:00Z", CLAIM), false, "a call before the consent is not covered, claimed or not");
  assert.equal(consentValidAt(art("claimed", "2026-01-01T10:00Z", "2026-01-01T10:05Z"), "2026-06-01T09:00Z", CLAIM), true);
  assert.equal(consentValidAt(art("pending", "2026-01-01T10:00Z", "2026-01-01T10:05Z"), "2026-01-04T10:00Z", CLAIM), true, "inside the 72 h window");
  assert.equal(consentValidAt(art("pending", "2026-01-01T10:00Z", "2026-01-01T10:05Z"), "2026-01-04T10:01Z", CLAIM), false, "past the window: the gate and the report agree");
  assert.equal(consentValidAt(art("pending", null, "2026-01-01T10:05Z", "jornaya"), "2027-01-01T00:00Z", CLAIM), true, "no published window: not refused on age");
  assert.equal(consentValidAt(art("expired", "2026-01-01T10:00Z", "2026-01-01T10:05Z"), "2026-01-01T11:00Z", CLAIM), false);
  const sql = read(MIGRATION);
  for (const at of ["'2026-01-01T09:00Z'", "'2026-06-01T09:00Z'", "'2026-01-04T10:00Z'", "'2026-01-04T10:01Z'", "'2027-01-01T00:00Z'", "'2026-01-01T11:00Z'"]) assert.ok(sql.includes(at), `the SQL corpus has ${at}`);
});

test("the gap checks: consent must precede the call, DNC entries must be active", () => {
  const sql = read(MIGRATION);
  const gaps = sql.slice(sql.indexOf("create or replace function public.compliance_gaps("), sql.indexOf("revoke all on function public.compliance_gaps"));
  assert.match(gaps, /k\.event_type = 'consent' and k\.event_at <= c\.at\)\n   group by c\.p;/, "gap 1: consent given at or before the call");
  assert.match(gaps, /public\.compliance_consent_valid_at\(t\.capture_status, t\.provider, t\.consent_timestamp, t\.captured_at, c\.at, p_claim_hours\)/, "gap 6: the shared rule at the call's time");
  assert.doesNotMatch(gaps, /t\.capture_status = 'claimed'\n/, "gap 6 no longer passes any claimed artefact");
  assert.match(gaps, /join public\.tenant_do_not_call n on n\.id = k\.source_id and n\.tenant_id = k\.tenant_id[\s\S]*?and n\.is_active/, "gap 4: active entries, like the dashboard's dnc_active");
});

test("history is keyed on the number at the time, not the lead's number today", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /select c\.tenant_id, coalesce\(c\.phone_digits, public\.compliance_lead_phone\(l\.values\)\), l\.contact_id, c\.lead_id, 'consent'/);
  assert.match(sql, /select a\.tenant_id, coalesce\(a\.dialled_phone_digits, public\.compliance_lead_phone\(l\.values\)\), l\.contact_id, a\.lead_id, 'call_attempt'/);
  assert.match(sql, /create trigger compliance_phone_at_time before insert or update of lead_id on public\.tenant_call_attempts/);
  assert.match(sql, /create trigger compliance_phone_at_time before insert or update of lead_id on public\.tenant_consent_artefacts/);
  // The consent index trigger is paused only around the backfill, and the self-check proves it is back on.
  assert.ok(sql.indexOf("enable trigger compliance_index_sync") > sql.indexOf("disable trigger compliance_index_sync"));
  assert.match(sql, /the consent index trigger was left disabled/);
});

test("retention: holds follow the person and the policy; consent ages from last reliance; the live run needs a seen summary", () => {
  const sql = read(MIGRATION);
  const exec = sql.slice(sql.indexOf("create or replace function public.retention_execute("), sql.indexOf("revoke all on function public.retention_execute"));
  assert.doesNotMatch(exec, /legal_hold_active\(p_tenant_id, public\.compliance_lead_phone\(l\.values\), l\.contact_id, null\)/, "no more policy-blind, current-number-only holds");
  assert.match(exec, /legal_hold_active_for_lead\(p_tenant_id, c\.lead_id, coalesce\(c\.phone_digits/);
  assert.match(exec, /legal_hold_active_for_lead\(p_tenant_id, a\.lead_id, coalesce\(a\.dialled_phone_digits/);
  assert.match(exec, /rel\.last_relied < now\(\) - make_interval/, "consent is aged from its last reliance");
  assert.match(exec, /'source_record_id', c\.id::text/, "a transfer verdict that passed on the artefact counts as reliance");
  assert.match(exec, /the retention rules changed after the last dry run/);
  assert.match(exec, /nobody has received or acknowledged the last dry run''s summary/);
  const sched = sql.slice(sql.indexOf("create or replace function public.retention_scheduled("), sql.indexOf("revoke all on function public.retention_scheduled"));
  assert.match(sched, /live_skipped_reason = v_reason/);
  assert.match(sched, /exception when others then/, "one tenant failing does not stop the others");
  const hold = sql.slice(sql.indexOf("create or replace function public.legal_hold_active_for_lead("), sql.indexOf("revoke all on function public.legal_hold_active_for_lead"));
  assert.match(hold, /from public\.compliance_index i/, "historical numbers come from the index");
  assert.match(hold, /h\.scope = 'policy_number'[\s\S]*policy_current/, "a policy hold reaches the client's records");
  // The summary route records how many it actually reached.
  assert.match(read("app/api/cron/retention-summary/route.ts"), /markSummarySent\(run\.id, reached\)/);
});

test("the evidence report: producers only for leads they worked; the report roles apply everywhere", () => {
  const ev = read("lib/compliance/evidenceReport.ts");
  const build = ev.slice(ev.indexOf("export async function buildEvidenceReport"));
  assert.match(build.slice(0, 300), /await assertEvidenceAccess\(viewer, scope\);/, "every generation path (route, page, complaint) goes through it");
  assert.match(ev, /if \(!\(await mayGenerateReports\(viewer\.tenantId, viewer\.role\)\)\)/);
  assert.match(ev, /if \(viewer\.role === "owner"\) return;/);
  assert.match(ev, /from\("lead_queue"\)\.select\("id"\)\.eq\("tenant_id", tenantId\)\.eq\("owner_user_id", userId\)/);
  assert.match(ev, /opts\.numbers !== false && viewer\.role === "owner"/, "the book-wide number lists are the owner's");
});

test("a complaint's evidence report is a frozen stored copy, and a failure to attach is said", () => {
  const store = read("lib/compliance/complaintStore.ts");
  assert.match(store, /buildEvidencePdf\(report\)/);
  assert.match(store, /storage\.from\(COMPLAINT_BUCKET\)\.upload\(path, Buffer\.from\(bytes\)/);
  assert.match(store, /frozen: true/);
  assert.doesNotMatch(store, /link: `\/api\/app\/compliance\/evidence\?phone=/, "no live regenerate-on-click link");
  assert.match(store, /return \{ attached: false, reason \};/);
  assert.match(read("app/api/app/compliance/complaints/route.ts"), /evidence_warning: evidence\.attached \? null : evidence\.reason/);
  assert.match(store, /file\.kind === "evidence_report" && !\(await mayGenerateReports\(viewer\.tenantId, viewer\.role\)\)/);
});

test("the dashboard says when a check could not run, instead of showing nothing", () => {
  const base = { complaints: [], gaps: [], expiries: [], deadlineCoverage: null, now: new Date("2026-10-15T12:00:00Z") };
  const failed = dashboardAlerts({ ...base, gaps: null, complaints: null, failed: { gaps: true, complaints: true } });
  assert.deepEqual(failed.map((a) => a.key), ["complaints_unchecked", "gaps_unchecked"]);
  assert.ok(failed.every((a) => a.severity === "critical"));
  assert.deepEqual(dashboardAlerts(base).map((a) => a.key), [], "a clean answer is still no alerts");
  const skipped = dashboardAlerts({ ...base, purgeSkipped: { at: "2026-10-15T04:30:00Z", reason: "summary_not_delivered" } });
  assert.match(skipped[0].text, /did not run: nobody received or acknowledged/);
  assert.match(read("lib/compliance/dashboard.ts"), /failed: \{ gaps: scanResult === FAILED, complaints: complaintsResult === FAILED \}/);
});
