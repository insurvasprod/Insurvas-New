import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { relationshipExpiry, RELATIONSHIP_MONTHS } = await import("./exemptionConstants.ts");
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20260925709700_dnc_exemptions_clear_registry_dnc_only.sql");

test("LA-2.3-3: a relationship lasts 18 months after a purchase, 3 after an inquiry, as Postgres computes it", () => {
  assert.deepEqual(RELATIONSHIP_MONTHS, { purchase: 18, inquiry: 3 });
  assert.equal(relationshipExpiry("purchase", "2026-03-15"), "2027-09-15");
  assert.equal(relationshipExpiry("inquiry", "2026-09-10"), "2026-12-10");
  // date + interval clamps to the month's last day in Postgres: 31 Aug + 3 months = 30 Nov.
  assert.equal(relationshipExpiry("inquiry", "2026-08-31"), "2026-11-30");
  assert.equal(relationshipExpiry("purchase", "2024-08-31"), "2026-02-28");
  assert.equal(relationshipExpiry("inquiry", "not a date"), null);
  assert.match(sql, /p_relationship_date \+ interval '18 months'/);
  assert.match(sql, /p_relationship_date \+ interval '3 months'/);
});

test("LA-2.3-3: an exemption clears federal and state DNC only, never the agency's own list or a litigator", () => {
  // Both gates skip exactly the two registry lists while an exemption is active.
  const isps = sql.slice(sql.indexOf("create or replace function public.is_phone_suppressed"));
  assert.match(isps, /not \(s\.list_type in \('federal_dnc', 'state_dnc'\)\s+and public\.dnc_exemption_active_id\(/);
  assert.doesNotMatch(isps.slice(0, isps.indexOf("$function$;")), /tenant_do_not_call d[\s\S]*dnc_exemption_active_id/);
  const hits = sql.slice(sql.indexOf("create or replace function public.tenant_phone_suppression_hits"));
  assert.match(hits, /and not \(v_exemption is not null and s\.list_type in \('federal_dnc', 'state_dnc'\)\)/);
  // Every use at the dialer's gate is audited, and only when nothing else still refuses.
  assert.match(hits, /insert into public\.tenant_dnc_exemption_uses[\s\S]*'dial_gate'/);
  // Written consent needs a claimed, stored certificate for the same number, re-checked on every use.
  assert.match(sql, /dnc_exemption_certificate_not_stored/);
  assert.match(sql, /dnc_exemption_certificate_other_number/);
  assert.match(sql, /a\.capture_status = 'claimed'\s+and \(a\.stored_copy is not null or a\.stored_ref is not null\)/);
  // Owner only, one open record per number, and the assertions roll themselves back.
  assert.match(sql, /dnc_exemption_owner_only/);
  assert.match(sql, /exclude using btree \(tenant_id with =, phone_digits with =\) where \(revoked_at is null\)/);
  assert.match(sql, /raise exception 'fix_s_709700_rollback'/);
});

test("LA-2.3-3: the live registry lookup at the dial honours and audits an exemption", () => {
  const service = read("lib/compliance/service.ts");
  const preflight = service.slice(service.indexOf("export async function performDncDialPreflight"));
  // The agency's own list is refused before the registry is asked, so an exemption cannot reach it.
  assert.ok(preflight.indexOf("is_tenant_phone_suppressed") < preflight.indexOf("use_dnc_exemption"));
  assert.match(preflight, /use_dnc_exemption[\s\S]*p_context: "dial"[\s\S]*p_cleared_lists: \["dnc_registry"\]/);
});

test("LA-2.3-3 / LA-2.3-9: the routes are registered and owner-gated where they write", () => {
  const route = read("app/api/app/suppression/exemptions/route.ts");
  assert.match(route, /const WRITE_ROLES = \["owner"\] as const/);
  assert.match(route, /export async function POST[\s\S]*requireFeatureRole\("tcpa_checker", WRITE_ROLES/);
  assert.match(route, /export async function PATCH[\s\S]*requireFeatureRole\("tcpa_checker", WRITE_ROLES/);
  assert.match(route, /tenant\.dnc_exemption_recorded/);
  assert.match(route, /tenant\.dnc_exemption_revoked/);
  const suppression = read("app/api/app/suppression/route.ts");
  assert.match(suppression, /params\.get\("audit"\)[\s\S]*listScreeningAudit/);
  const audit = read("lib/suppression/screeningAudit.ts");
  for (const column of ["ts", "phone_digits", "outcome", "vendor", "cached", "user_id", "partner_id", "lead_id", "raw_response"]) assert.match(audit, new RegExp(`\\b${column}\\b`));
});
