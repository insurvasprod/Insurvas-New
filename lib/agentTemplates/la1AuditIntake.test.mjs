// LA-1 audit (2026-10-15): static contracts for the inbound fixes that have no database-free seam.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("a new lead alerts buffer agents (assistant) as well as owners and producers", () => {
  const intake = read("lib/agentTemplates/intake.ts");
  assert.match(intake, /roles: \["owner", "producer", "assistant"\],\n\s+kind: "new_unclaimed_lead"/);
});

test("the deal-flow date is the agency's day, and a replay never moves it", () => {
  const intake = read("lib/agentTemplates/intake.ts");
  assert.match(intake, /intakeLocalDate\(\(await getWorkspaceTimezone\(input\.tenantId\)\) \?\? input\.partnerTimezone\)/);
  assert.match(intake, /onConflict: "lead_id", ignoreDuplicates: true/);
});

test("the affiliate path runs the LA-6.2 transfer gate and refuses an internal DQ it cannot justify", () => {
  const route = read("app/api/affiliate/[slug]/route.ts");
  assert.match(route, /await evaluateTransfer\(\{ tenantId: existing\.tenant_id/);
  assert.doesNotMatch(route, /screenPartnerPhone\(/);
  assert.match(route, /gate\.decision\.blockingReason === "internal_dnc" \|\| gate\.decision\.blockingReason === "consent_missing"/);
  assert.match(route, /recordRejectedPartnerSubmission\(/);
  assert.match(route, /requireInternalDqReason: true, duplicateOverrideJustification: null/);
  assert.match(route, /linkVerdictToLead\(existing\.tenant_id, gate\.verdictId, result\.lead\.id\)/);
  assert.match(route, /"internal_dq_reason_required"\) return NextResponse\.json\(REFERRAL_REFUSED, \{ status: 422 \}\)/);
  // Partner access is part of publisher_records, and a cross-site post is refused.
  assert.match(route, /hasFeature\(entitlement, PARTNER_PORTAL_FEATURE\)/);
  assert.match(route, /refuseCrossSite\(/);
});

test("partner sessions and partner sign-in need the agency's publisher_records", () => {
  const guard = read("lib/partnerAuth/requirePartner.ts");
  assert.match(guard, /export const PARTNER_PORTAL_FEATURE = "publisher_records";/);
  assert.match(guard, /if \(!agencyHasPartners\) return null;/);
  const login = read("app/api/partner/auth/login/route.ts");
  assert.match(login, /code: "partner_portal_unavailable"/);
});

test("every plan with inbound_transfers gets publisher_records and partner_quality, and partner_portal is archived", () => {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const file = readdirSync(dir).find((name) => name.startsWith("20261015590000_"));
  assert.ok(file);
  const sql = read(`supabase/migrations/${file}`);
  assert.match(sql, /cross join \(values \('publisher_records'\), \('partner_quality'\)\) as f\(key\)\n where pf\.feature_key = 'inbound_transfers'/);
  assert.match(sql, /set is_archived = true/);
  assert.match(sql, /perform public\.refresh_tenant_entitlement\(v_tenant\)/);
});

test("partners never see the internal outcome note (table, CSV, detail)", () => {
  const service = read("lib/partnerLeads/service.ts");
  const types = read("lib/partnerLeads/types.ts");
  assert.doesNotMatch(service, /outcomeNote|"outcome_note"/);
  assert.doesNotMatch(types, /outcomeNote/);
  assert.doesNotMatch(service, /select\("lead_id, notes/);
});

test("a committed claim is never reported as failed because its audit row could not be written", () => {
  const service = read("lib/transferInbox/service.ts");
  assert.match(service, /action: "tenant\.transfer_claimed"[^\n]*\n\s+\.catch\(\(auditError\)/);
});

test("opening the inbound outcome wizard is a POST; the GET writes nothing", () => {
  const route = read("app/api/app/inbound/disposition/route.ts");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.doesNotMatch(get, /getDispositionWizard/);
  assert.match(route, /action: z\.literal\("start"\)/);
  const hook = read("components/app/use-disposition-walk.ts");
  assert.match(hook, /JSON\.stringify\(\{ action: "start", work_item_id: workItemId \}\)/);
});

test("deal-flow edits are audited old → new", () => {
  const route = read("app/api/app/deal-flow/[id]/route.ts");
  assert.match(route, /metadata: \{ fields: Object\.keys\(changes\), changes \}/);
  assert.match(read("lib/dealFlow/service.ts"), /changes\[field\] = \{ from: clip\(was\), to: clip\(next\) \}/);
});

test("a deleted default disposition mapping stays deleted (seeded once per pipeline)", () => {
  const service = read("lib/pipelines/service.ts");
  assert.match(service, /if \(pipeline\.data\.seeded\) return;/);
  assert.match(service, /default_mappings_seeded_at/);
});

test("the inbox keeps the longest-waiting callers when it caps at 500", () => {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const file = readdirSync(dir).find((name) => name.startsWith("20261015593000_"));
  const sql = read(`supabase/migrations/${file}`);
  assert.match(sql, /order by case when p_status in \('unclaimed', 'open'\) then q\.queued_at end asc,\n\s+q\.queued_at desc\n\s+limit 500/);
  assert.match(sql, /order by newest\.queued_at asc/);
  assert.match(sql, /and q\.status = any \(case p_status/);
});

test("a heartbeat does not broadcast floor_changed", () => {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const file = readdirSync(dir).find((name) => name.startsWith("20261015594000_"));
  const sql = read(`supabase/migrations/${file}`);
  assert.match(sql, /after insert or delete on public\.agent_presence/);
  assert.match(sql, /when \(old\.status is distinct from new\.status\)/);
});

test("the portal submit answers a compliance reject neutrally, hides duplicate lead ids, and maps an unrecorded verdict to 503", () => {
  const route = read("app/api/partner/leads/route.ts");
  // The audit row (agency side) keeps the masked number; the response to the partner does not.
  assert.doesNotMatch(route, /code: TCPA_REJECTION_REASON,\n\s+blocked: true,\n\s+phone: rejection\.maskedPhone/);
  assert.match(route, /partnerRejectPayload\(Math\.max\(count, 1\), NEUTRAL_END_CALL_SCRIPT\)/);
  assert.doesNotMatch(route, /matches: error\.matches,\n\s+\},\n\s+\{ status: 409 \}/);
  assert.match(route, /matches: error\.matches\.map\(\(match\) => \(\{ matchedOn: match\.matchedOn \}\)\)/);
  assert.match(route, /error instanceof TransferGateUnrecorded/);
  assert.match(read("app/api/affiliate/[slug]/route.ts"), /error instanceof TransferGateUnrecorded/);
});
