import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("LA-2.3-9: a check for a known lead writes lead_id, and every audit row's id is returned", () => {
  const screening = read("lib/compliance/screening.ts");
  assert.match(screening, /lead_id: \(params\.leadId \?\? null\) as never/);
  assert.match(screening, /\.select\("id"\)\.single<\{ id: string \}>\(\)/);
  // Before 20260925709750 the live FK still names the legacy leads table: the check is audited
  // without the link rather than failing the screening closed.
  assert.match(screening, /error\?\.code === "23503" && params\.leadId\) \(\{ data, error \} = await insert\(\{ \.\.\.row, lead_id: null as never \}\)\)/);
  assert.match(read("supabase/migrations/20260925709750_screening_audit_lead_fk_to_agent_leads.sql"), /foreign key \(lead_id\) references public\.agent_leads\(id\) on delete set null/);
  // screeningDeps is where the lead is bound, and the audit id travels back on the decision.
  assert.match(screening, /function screeningDeps\(input: \{[^}]*leadId: string \| null/);
  assert.match(screening, /leadId: input\.leadId, \.\.\.entry/);
  assert.match(screening, /return \{ \.\.\.decision, auditId \}/);
  // The known-lead callers pass it.
  assert.match(read("lib/campaigns/scrubRun.ts"), /screenPartnerPhone\(\{[^}]*leadId: lead\.id \}\)/);
  assert.match(read("lib/compliance/dialPreflight.ts"), /checkLitigatorForDialPreflight\(\{[^}]*leadId: found/);
  assert.match(read("lib/nurture/service.ts"), /screenPartnerPhone\(\{[^}]*leadId: item\.lead_id \}\)/);
});

test("LA-2.3-9: checks made before the lead existed are linked afterwards, and never fail the write", () => {
  const screening = read("lib/compliance/screening.ts");
  const single = screening.slice(screening.indexOf("export async function linkScreeningAuditToLead"), screening.indexOf("const LINK_FALLBACK_CAP"));
  assert.match(single, /try \{/);
  assert.match(single, /catch \(error\) \{\s*console\.error/);
  assert.doesNotMatch(single, /throw /);
  const bulk = screening.slice(screening.indexOf("export async function linkScreeningAuditsToLeads"), screening.indexOf("export type ScreenedDecision"));
  assert.doesNotMatch(bulk, /throw /);
  assert.match(bulk, /link_screening_audit_leads/);
  // Partner submit (new lead, replay and race), real-time post (new and duplicate), both imports.
  const partner = read("lib/agentTemplates/service.ts");
  assert.ok((partner.match(/await linkAudit\(/g) ?? []).length >= 3);
  assert.match(partner, /linkScreeningAuditsToLeads\(tenantId, imported\.map/);
  const post = read("lib/leadPost/service.ts");
  assert.match(post, /linkScreeningAuditToLead\(\{ tenantId: keyRow\.tenant_id, auditId: screening\.auditId, leadId: created\.id \}\)/);
  assert.match(post, /linkScreeningAuditToLead\(\{ tenantId: keyRow\.tenant_id, auditId: screening\.auditId, leadId: existing\.id \}\)/);
  const preflight = read("lib/agentTemplates/importPreflight.ts");
  assert.match(preflight, /auditId: decision\.auditId/);
  assert.match(preflight, /linkScreeningAuditsToLeads\(input\.tenantId, committed\.ids\.map/);
  const sql = read("supabase/migrations/20260925709740_link_screening_audit_leads.sql");
  assert.match(sql, /a\.tenant_id = p_tenant_id[\s\S]*a\.lead_id is null[\s\S]*x\.tenant_id = p_tenant_id/);
});
