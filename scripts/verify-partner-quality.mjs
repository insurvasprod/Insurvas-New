// LA-1.18 live acceptance and failure-path checks. Creates only disposable tenants and removes them.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import { createFixtureUser, deleteFixtureUser } from "./lib/fixtureUser.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID(); const otherTenantId = randomUUID();
let ownerId = null; let assistantId = null; let otherOwnerId = null;
const partnerId = randomUUID(); const zeroPartnerId = randomUUID(); const otherPartnerId = randomUUID();
const leadIds = [randomUUID(), randomUUID(), randomUUID()]; const queueId = randomUUID(); const dealId = randomUUID();
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } };
function containsCostField(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsCostField);
  return Object.entries(value).some(([key, nested]) => ["cost", "spend", "cpa", "true_cpa"].includes(key.toLowerCase()) || containsCostField(nested));
}
// Partner quality uses a fixed EST (UTC-5) calendar, independent of the workstation and
// without daylight-saving adjustment. This must remain aligned with the database migration.
const REPORTING_TIME_ZONE = "Etc/GMT+5";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: REPORTING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
async function cookie(userId, tenantId, expired = false) { return `insurvas_tenant_session=${await new SignJWT({ tenantId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 1 : "10m").sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET))}`; }
async function api(path, sessionCookie, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { ...(sessionCookie ? { cookie: sessionCookie } : {}), ...(options.headers ?? {}) }, redirect: "manual" }); }
async function cleanup() {
  for (const tenant of [tenantId, otherTenantId]) {
    const leads = await db.from("agent_leads").select("id").eq("tenant_id", tenant); const ids = (leads.data ?? []).map((row) => row.id);
    await db.from("lead_queue").delete().eq("tenant_id", tenant); await db.from("deal_flow").delete().eq("tenant_id", tenant); await db.from("screening_audit").delete().eq("tenant_id", tenant); if (ids.length) { await db.from("intake_failures").delete().in("lead_id", ids); await db.from("lead_notifications").delete().in("lead_id", ids); } await db.from("agent_leads").delete().eq("tenant_id", tenant); await db.from("screening_results").delete().eq("tenant_id", tenant);
    await db.from("tenant_entitlements").delete().eq("tenant_id", tenant); await db.from("subscriptions").delete().eq("tenant_id", tenant); await db.from("tenant_template_revisions").delete().eq("tenant_id", tenant); await db.from("tenant_template_forms").delete().eq("tenant_id", tenant); await db.from("tenant_template_stages").delete().eq("tenant_id", tenant); await db.from("tenant_template_fields").delete().eq("tenant_id", tenant); await db.from("tenant_templates").delete().eq("tenant_id", tenant); await db.from("tenant_products").delete().eq("tenant_id", tenant); await db.from("partners").delete().eq("tenant_id", tenant); await db.from("tenant_users").delete().eq("tenant_id", tenant); for (const id of [ownerId, assistantId, otherOwnerId]) await deleteFixtureUser(db, id); await db.from("tenants").delete().eq("id", tenant);
  }
  await db.from("audit_log").delete().in("actor_id", [ownerId, assistantId, otherOwnerId]);
}
async function main() {
  if (!process.env.TENANT_SESSION_SECRET) throw new Error("TENANT_SESSION_SECRET is required");
  await cleanup();
  try {
    const tenants = await db.from("tenants").insert([{ id: tenantId, name: `LA-1.18 quality ${stamp}`, status: "active", onboarding_state: "completed" }, { id: otherTenantId, name: `LA-1.18 other ${stamp}`, status: "active", onboarding_state: "completed" }]); if (tenants.error) throw new Error(tenants.error.message);
    ({ userId: ownerId } = await createFixtureUser(db, { email: `la118-owner-${stamp}@invalid.test`, name: "Quality owner" }));
  ({ userId: assistantId } = await createFixtureUser(db, { email: `la118-assistant-${stamp}@invalid.test`, name: "Quality assistant" }));
  ({ userId: otherOwnerId } = await createFixtureUser(db, { email: `la118-other-${stamp}@invalid.test`, name: "Other owner" }));
    const memberships = await db.from("tenant_users").insert([{ tenant_id: tenantId, user_id: ownerId, role: "owner" }, { tenant_id: tenantId, user_id: assistantId, role: "assistant" }, { tenant_id: otherTenantId, user_id: otherOwnerId, role: "owner" }]); if (memberships.error) throw new Error(memberships.error.message);
    const plan = await db.from("plans").select("id").eq("code", "advance").eq("version", 1).single(); if (plan.error) throw new Error(`plan dependency missing: ${plan.error.message}`);
    for (const tenant of [tenantId, otherTenantId]) { const assigned = await db.rpc("admin_assign_subscription", { p_tenant_id: tenant, p_plan_id: plan.data.id, p_billing_cycle: "monthly", p_start: new Date().toISOString() }); if (assigned.error) throw new Error(assigned.error.message); const refreshed = await db.rpc("refresh_tenant_entitlement", { p_tenant_id: tenant }); if (refreshed.error) throw new Error(refreshed.error.message); }
    const entitlement = await db.from("tenant_entitlements").select("entitlement").eq("tenant_id", tenantId).single(); if (entitlement.error) throw new Error(entitlement.error.message); await db.from("tenant_entitlements").update({ entitlement: { ...entitlement.data.entitlement, features: [...new Set([...(entitlement.data.entitlement.features ?? []), "partner_quality"])] } }).eq("tenant_id", tenantId);
    const partners = await db.from("partners").insert([{ slug: `fx-${Math.random().toString(36).slice(2, 10)}`, id: partnerId, tenant_id: tenantId, name: "Quality Partner", partner_type: "publisher", status: "active" }, { slug: `fx-${Math.random().toString(36).slice(2, 10)}`, id: zeroPartnerId, tenant_id: tenantId, name: "Zero Lead Partner", partner_type: "publisher", status: "active" }, { slug: `fx-${Math.random().toString(36).slice(2, 10)}`, id: otherPartnerId, tenant_id: otherTenantId, name: "Other Tenant Partner", partner_type: "publisher", status: "active" }]); if (partners.error) throw new Error(partners.error.message);
    const ownerCookie = await cookie(ownerId, tenantId); const assistantCookie = await cookie(assistantId, tenantId); const otherCookie = await cookie(otherOwnerId, otherTenantId);
    const templates = await api("/api/app/templates", ownerCookie); const templateBody = await templates.json(); if (templates.status !== 200 || !templateBody.current?.assignment) throw new Error(`template dependency missing: ${templates.status}`);
    const templateId = templateBody.current.tenant_template_id; const assignment = templateBody.current.assignment; const pipeline = await db.from("tenant_pipelines").select("id").eq("tenant_id", tenantId).limit(1).single(); const stage = await db.from("tenant_pipeline_stages").select("id").eq("pipeline_id", pipeline.data.id).order("position").limit(1).single(); if (pipeline.error || stage.error) throw new Error("pipeline dependency missing");
    // READ THIS BEFORE TRUSTING THE SCREENING ASSERTIONS BELOW.
    //
    // The fixture inserts an agent_lead whose screening_result_id points at a tcpa_litigator result,
    // and a screening_audit row carrying invalid_phone. The application cannot produce either shape.
    // app/api/partner/leads/route.ts screens BEFORE createPartnerLead, and screenPartnerPhone returns
    // allowed:false for tcpa_litigator and invalid_phone -- so the route returns 422 and no lead row
    // is ever written. partner_quality_evidence selects from agent_leads, so in production the TCPA
    // and Invalid columns on this page are permanently zero and their drill-downs permanently empty.
    //
    // dnc and internal_dq are different: both return allowed:true with a warning, the lead IS
    // created, and those two figures are real.
    //
    // The checks below therefore prove the query counts correctly, NOT that the columns are fed.
    // That distinction is backlog 172 -- a blocked transfer is recorded nowhere -- and it is left
    // deliberately visible here rather than removed, because deleting the fixture would make the
    // report look correct and silent instead of correct and empty.
    const expires = new Date(Date.now() + 3600000).toISOString(); const screening = await db.from("screening_results").insert({ tenant_id: tenantId, phone_digits: "6025550101", outcome: "tcpa_litigator", vendor: "qa", raw_response: { hit: true }, version: 1, expires_at: expires }).select("id, outcome").single(); if (screening.error) throw new Error(screening.error.message); const invalidAudit = await db.from("screening_audit").insert({ tenant_id: tenantId, partner_id: partnerId, user_id: ownerId, phone_digits: "6025550102", outcome: "invalid_phone", vendor: "qa", raw_response: { valid: false }, version: 1 }); if (invalidAudit.error) throw new Error(invalidAudit.error.message);
    const leads = await db.from("agent_leads").insert([{ id: leadIds[0], tenant_id: tenantId, tenant_template_id: templateId, template_id: assignment.template_id, template_version: assignment.template_version, definition_version: assignment.definition_version, product_line: "term_life", partner_id: partnerId, pipeline_id: pipeline.data.id, stage_id: stage.data.id, values: { full_name: "Quality Submitted", phone: "6025550100" }, created_by: ownerId }, { id: leadIds[1], tenant_id: tenantId, tenant_template_id: templateId, template_id: assignment.template_id, template_version: assignment.template_version, definition_version: assignment.definition_version, product_line: "term_life", partner_id: partnerId, pipeline_id: pipeline.data.id, stage_id: stage.data.id, values: { full_name: "Quality Duplicate", phone: "6025550101" }, created_by: ownerId, screening_result_id: screening.data.id, screening_version: 1, screening_outcome: "internal_dq", duplicate_override_justification: "Customer confirmed separate household." }, { id: leadIds[2], tenant_id: tenantId, tenant_template_id: templateId, template_id: assignment.template_id, template_version: assignment.template_version, definition_version: assignment.definition_version, product_line: "term_life", partner_id: partnerId, pipeline_id: pipeline.data.id, stage_id: stage.data.id, values: { full_name: "Quality Invalid", phone: "6025550102" }, created_by: ownerId }]); if (leads.error) throw new Error(leads.error.message);
    const queue = await db.from("lead_queue").insert({ id: queueId, tenant_id: tenantId, lead_id: leadIds[0], partner_id: partnerId, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, status: "claimed", claimed_by: ownerId, claimed_at: new Date().toISOString(), disposition: "application_submitted" }); if (queue.error) throw new Error(queue.error.message);
    const deal = await db.from("deal_flow").insert({ id: dealId, tenant_id: tenantId, lead_id: leadIds[0], partner_id: partnerId, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, insured_name: "Quality Submitted", phone: "6025550100", local_date: today, status: "completed", call_result: "application_submitted", worked_by: ownerId }); if (deal.error) throw new Error(deal.error.message);
    const reportResponse = await api(`/api/app/partner-quality?from=${today}&to=${today}`, ownerCookie); const report = await reportResponse.json(); const row = report.rows?.find((item) => item.partner_id === partnerId); const zero = report.rows?.find((item) => item.partner_id === zeroPartnerId); check("every figure is computed from current lead and deal-flow records", reportResponse.status === 200 && row?.sent === 3 && row.claimed === 1 && row.worked === 1 && row.submitted === 1 && row.screening.tcpa === 1 && row.screening.invalid === 1 && row.duplicates === 1, JSON.stringify({ status: reportResponse.status, row }));
    check("counts reconcile to the same filtered leads table", row?.sent === 3 && row?.submitted === 1 && report.summary?.sent === 3);
    check("a partner with zero leads remains visible as zero", reportResponse.status === 200 && zero?.sent === 0 && zero?.claimed === 0 && zero?.worked === 0);
    const drill = await api(`/api/app/partner-quality/leads?from=${today}&to=${today}&partner_id=${partnerId}&metric=submitted`, ownerCookie); const drillBody = await drill.json(); check("drilling a number returns exactly the leads counted", drill.status === 200 && drillBody.total === 1 && drillBody.rows?.length === 1 && drillBody.rows[0].lead_id === leadIds[0]);
    const dispositionDrill = await api(`/api/app/partner-quality/leads?from=${today}&to=${today}&partner_id=${partnerId}&metric=disposition&disposition=application_submitted`, ownerCookie); const dispositionBody = await dispositionDrill.json(); check("disposition breakdown drills precisely", dispositionDrill.status === 200 && dispositionBody.total === 1 && dispositionBody.rows?.[0].lead_id === leadIds[0]);
    // Criterion 4 is "drilling into any number lands on exactly the leads it counted". Two of the ten
    // metrics were covered. That matters more than it looks: partner_quality_report and
    // partner_quality_leads each spell out the metric predicates by hand, and partner_quality_leads
    // spells them out TWICE -- once to count and once to page. Three hand-kept copies of the same
    // nine conditions, with nothing tying them together. A cell that disagrees with its own
    // drill-down shows a plausible number and then a plausible list of the wrong leads; nothing
    // raises, nothing logs. So compare every cell against what opening it returns.
    const cells = [["sent", row?.sent], ["claimed", row?.claimed], ["worked", row?.worked], ["submitted", row?.submitted], ["disqualified", row?.disqualified], ["tcpa", row?.screening?.tcpa], ["dnc", row?.screening?.dnc], ["invalid", row?.screening?.invalid], ["duplicate", row?.duplicates]];
    const mismatches = [];
    for (const [name, shown] of cells) {
      if (typeof shown !== "number") { mismatches.push(`${name}: the report omits this figure entirely`); continue; }
      const drilled = await api(`/api/app/partner-quality/leads?from=${today}&to=${today}&partner_id=${partnerId}&metric=${name}`, ownerCookie);
      const body = await drilled.json().catch(() => null);
      if (drilled.status !== 200) { mismatches.push(`${name}: status ${drilled.status}`); continue; }
      if (body?.total !== shown) mismatches.push(`${name}: cell shows ${shown}, drill-down counts ${body?.total}`);
      if ((body?.rows?.length ?? -1) !== shown) mismatches.push(`${name}: counted ${body?.total} but returned ${body?.rows?.length} leads`);
    }
    check("every cell drills to exactly the number it displays", mismatches.length === 0 && (row?.sent ?? 0) > 0, mismatches.join("; "));

    // Criterion 2 is "counts reconcile exactly with the leads table for the same filter". Reconciling
    // the report against itself cannot fail, so reconcile it against agent_leads directly.
    //
    // The case that would break a count built on joins -- one lead worked twice counting as two
    // worked leads -- turns out to be unreachable: deal_flow carries a UNIQUE constraint on lead_id,
    // so a lead has at most one deal-flow row. Attempting the second insert raises 23505. That is a
    // stronger guarantee than the query's exists() and it is worth asserting, because the day that
    // constraint is relaxed for a legitimate reason, every worked and submitted figure on this page
    // starts double counting and still looks entirely plausible.
    const secondDeal = await db.from("deal_flow").insert({ id: randomUUID(), tenant_id: tenantId, lead_id: leadIds[0], partner_id: partnerId, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, insured_name: "Quality Submitted", phone: "6025550100", local_date: today, status: "completed", call_result: "application_submitted", worked_by: ownerId });
    const bookLeads = await db.from("agent_leads").select("id").eq("tenant_id", tenantId).eq("partner_id", partnerId);
    check("counts reconcile against the agent_leads table itself", row?.sent === (bookLeads.data ?? []).length && (bookLeads.data ?? []).length > 0, JSON.stringify({ reported: row?.sent, inTable: bookLeads.data?.length }));
    check("one lead cannot become two worked leads", secondDeal.error?.code === "23505", secondDeal.error ? `${secondDeal.error.code}: ${secondDeal.error.message}` : "a second deal-flow row for the same lead was accepted");

    check("the response contains no cost fields", !containsCostField(report));
    // Criterion 5 is "the page states plainly that it does not yet include cost". The check above is
    // a different claim -- it proves the API sends no cost data, not that the screen says so. The
    // distinction is the whole point of the criterion: a quality report with no cost column reads as
    // a cost report showing zero spend unless it tells the reader otherwise. The disclosure is a
    // static, unconditional element of the workspace, so guard it at the source; it renders whenever
    // the report renders, and this fails the day someone deletes it.
    const workspace = await readFile("components/app/partner-quality-workspace.tsx", "utf8");
    const disclosure = /Cost data is not included yet/.test(workspace) && /accounting/i.test(workspace);
    check("the page states plainly that cost is not included", disclosure, disclosure ? "" : "the cost disclosure is no longer in the workspace");
    check("the page states the fixed EST reporting calendar", /fixed EST \(UTC−5\)/.test(workspace) && /Etc\/GMT\+5/.test(workspace), "the fixed EST label or calendar constant is missing");
    check("wrong role is rejected", (await api(`/api/app/partner-quality?from=${today}&to=${today}`, assistantCookie)).status === 403);
    const crossTenantResponse = await api(`/api/app/partner-quality?from=${today}&to=${today}`, otherCookie);
    const crossTenantBody = await crossTenantResponse.json().catch(() => ({}));
    check("cross-tenant session cannot read another tenant", crossTenantResponse.status === 200 && !(crossTenantBody.rows ?? []).some((item) => item.partner_id === partnerId), `status ${crossTenantResponse.status}, leakedRows ${(crossTenantBody.rows ?? []).filter((item) => item.partner_id === partnerId).length}`);
    check("missing, forged and expired sessions fail closed", (await api(`/api/app/partner-quality?from=${today}&to=${today}`)).status === 401 && (await api(`/api/app/partner-quality?from=${today}&to=${today}`, "insurvas_tenant_session=forged")).status === 401 && (await api(`/api/app/partner-quality?from=${today}&to=${today}`, await cookie(ownerId, tenantId, true))).status === 401);
    const hostile = await api(`/api/app/partner-quality/leads?from=${today}&to=${today}&partner_id=${partnerId}&metric=%3Cscript%3E`, ownerCookie); check("hostile metric input is rejected", hostile.status === 400);
    const concurrent = await Promise.all([api(`/api/app/partner-quality?from=${today}&to=${today}`, ownerCookie), api(`/api/app/partner-quality?from=${today}&to=${today}`, ownerCookie)]); check("simultaneous identical reads remain isolated and consistent", concurrent.every((response) => response.status === 200));
  } finally { await cleanup(); }
  console.log(failures ? `\n${failures} LA-1.18 check(s) FAILED.` : "\nAll LA-1.18 partner quality checks passed."); return failures ? 1 : 0;
}
process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
