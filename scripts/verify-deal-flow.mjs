// LA-1.13 live acceptance and failure-path check. Creates only disposable tenants and removes them.
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantA = randomUUID(); const tenantB = randomUUID(); const ownerA = randomUUID(); const ownerB = randomUUID(); const assistantA = randomUUID(); const partnerA = randomUUID();
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } };
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const today = new Intl.DateTimeFormat("en-CA").format(new Date());
async function token(userId, tenantId, secret = process.env.TENANT_SESSION_SECRET, expired = false) { return new SignJWT({ tenantId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 1 : "10m").sign(new TextEncoder().encode(secret)); }
async function cookie(userId, tenantId, secret, expired = false) { return `insurvas_tenant_session=${await token(userId, tenantId, secret, expired)}`; }
async function api(path, sessionCookie, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { ...(sessionCookie ? { cookie: sessionCookie } : {}), ...(options.headers ?? {}) }, redirect: "manual" }); }

async function cleanup() {
  await db.from("audit_log").delete().in("actor_id", [ownerA, ownerB, assistantA]);
  await db.from("deal_flow").delete().eq("tenant_id", tenantA);
  await db.from("lead_queue").delete().eq("tenant_id", tenantA);
  await db.from("agent_leads").delete().eq("tenant_id", tenantA);
  await db.from("tenant_template_revisions").delete().eq("tenant_id", tenantA);
  await db.from("tenant_template_forms").delete().eq("tenant_id", tenantA);
  await db.from("tenant_template_stages").delete().eq("tenant_id", tenantA);
  await db.from("tenant_template_fields").delete().eq("tenant_id", tenantA);
  await db.from("tenant_templates").delete().eq("tenant_id", tenantA);
  await db.from("tenant_products").delete().eq("tenant_id", tenantA);
  await db.from("partner_products").delete().eq("partner_id", partnerA);
  await db.from("partners").delete().eq("id", partnerA);
  await db.from("tenant_entitlements").delete().in("tenant_id", [tenantA, tenantB]);
  await db.from("subscriptions").delete().in("tenant_id", [tenantA, tenantB]);
  await db.from("tenant_users").delete().in("user_id", [ownerA, ownerB, assistantA]);
  await db.from("users").delete().in("id", [ownerA, ownerB, assistantA]);
  await db.from("tenants").delete().in("id", [tenantA, tenantB]);
}

async function batchInsert(table, rows, size = 500) {
  for (let index = 0; index < rows.length; index += size) {
    const result = await db.from(table).insert(rows.slice(index, index + size));
    if (result.error) throw new Error(`${table} fixture failed: ${result.error.message}`);
  }
}

async function main() {
  if (!process.env.TENANT_SESSION_SECRET) throw new Error("TENANT_SESSION_SECRET is required");
  await cleanup();
  try {
    const tenantResult = await db.from("tenants").insert([{ id: tenantA, name: `LA-1.13 A ${stamp}`, status: "active", onboarding_state: "completed" }, { id: tenantB, name: `LA-1.13 B ${stamp}`, status: "active", onboarding_state: "completed" }]); if (tenantResult.error) throw new Error(tenantResult.error.message);
    const usersResult = await db.from("users").insert([{ id: ownerA, email: `la113-owner-a-${stamp}@invalid.test`, name: "LA-1.13 owner A", password_hash: "verification-only", status: "active" }, { id: ownerB, email: `la113-owner-b-${stamp}@invalid.test`, name: "LA-1.13 owner B", password_hash: "verification-only", status: "active" }, { id: assistantA, email: `la113-assistant-${stamp}@invalid.test`, name: "LA-1.13 assistant", password_hash: "verification-only", status: "active" }]); if (usersResult.error) throw new Error(usersResult.error.message);
    const memberships = await db.from("tenant_users").insert([{ tenant_id: tenantA, user_id: ownerA, role: "owner" }, { tenant_id: tenantB, user_id: ownerB, role: "owner" }, { tenant_id: tenantA, user_id: assistantA, role: "assistant" }]); if (memberships.error) throw new Error(memberships.error.message);
    const plan = await db.from("plans").select("id").eq("code", "advance").eq("version", 1).single(); if (plan.error) throw new Error(`advance plan missing: ${plan.error.message}`);
    for (const tenantId of [tenantA, tenantB]) { const subscription = await db.rpc("admin_assign_subscription", { p_tenant_id: tenantId, p_plan_id: plan.data.id, p_billing_cycle: "monthly", p_start: new Date().toISOString() }); if (subscription.error) throw new Error(subscription.error.message); const entitlement = await db.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId }); if (entitlement.error) throw new Error(entitlement.error.message); }
    const ownerCookie = await cookie(ownerA, tenantA); const otherCookie = await cookie(ownerB, tenantB); const assistantCookie = await cookie(assistantA, tenantA);
    const partner = await db.from("partners").insert({ id: partnerA, tenant_id: tenantA, name: `LA-1.13 Partner ${stamp}`, partner_type: "publisher", status: "active", timezone: "Pacific/Honolulu" }); if (partner.error) throw new Error(partner.error.message);
    const templateList = await api("/api/app/templates", ownerCookie); const templateBody = await templateList.json(); if (templateList.status !== 200 || !templateBody.current?.assignment) throw new Error(`template setup failed: ${templateList.status} ${JSON.stringify(templateBody).slice(0, 500)}`);
    const apply = await api("/api/app/templates", ownerCookie, { method: "POST", ...json({ template_id: templateBody.current.assignment.template_id, template_version: templateBody.current.assignment.template_version }) }); if (![200, 201].includes(apply.status)) throw new Error(`template apply failed: ${apply.status}`);
    const manualPayload = { product_line: "term_life", insured_name: "LA-1.13 Manual Customer", phone: "6025550199", partner_id: partnerA, local_date: today, carrier: "QA Carrier", product_type: "Level", monthly_premium_cents: 7140, face_amount_cents: 1200000, draft_date: today, initial_quote: "Term Life $71.40/mo", notes: "Outside-system deal" };
    const manual = await api("/api/app/deal-flow", ownerCookie, { method: "POST", ...json(manualPayload) }); const manualBody = await manual.json();
    const manualLead = manualBody.deal?.lead_id; const manualRows = manualLead ? await db.from("deal_flow").select("id, product_line, local_date, partner_id, manual_entry").eq("lead_id", manualLead) : { data: [] };
    check("a manual outside-system deal creates exactly one deal-flow row with explicit product", manual.status === 201 && manualRows.data?.length === 1 && manualRows.data[0].product_line === "term_life" && manualRows.data[0].local_date === today && manualRows.data[0].manual_entry === true);
    const auditCreated = manualBody.deal?.id ? await db.from("audit_log").select("id").eq("target_id", manualBody.deal.id).eq("action", "tenant.deal_flow_created") : { data: [] };
    check("manual creation writes an audit row", (auditCreated.data?.length ?? 0) >= 1);
    const options = await db.from("pipelines").select("id").eq("tenant_id", tenantA).limit(1).single(); if (options.error) throw new Error(`pipeline missing: ${options.error.message}`); const pipelineId = options.data.id; const stage = await db.from("pipeline_stages").select("id").eq("pipeline_id", pipelineId).order("position").limit(1).single(); if (stage.error) throw new Error(`stage missing: ${stage.error.message}`);
    const leadRows = Array.from({ length: 9999 }, (_, index) => ({ id: randomUUID(), tenant_id: tenantA, tenant_template_id: templateBody.current.tenant_template_id, template_id: templateBody.current.assignment.template_id, template_version: templateBody.current.assignment.template_version, definition_version: templateBody.current.assignment.definition_version, product_line: "term_life", pipeline_id: pipelineId, stage_id: stage.data.id, partner_id: partnerA, values: { full_name: `LA-1.13 Load ${index}`, phone: `602555${String(index).padStart(4, "0")}` }, created_by: ownerA }));
    await batchInsert("agent_leads", leadRows);
    await batchInsert("deal_flow", leadRows.map((lead, index) => ({ id: randomUUID(), tenant_id: tenantA, lead_id: lead.id, partner_id: partnerA, product_line: "term_life", pipeline_id: pipelineId, stage_id: stage.data.id, insured_name: `LA-1.13 Load ${index}`, phone: lead.values.phone, initial_quote: "Term Life", local_date: today, status: index % 3 === 0 ? "completed" : "partial", worked_by: ownerA, manual_entry: false })));
    const started = performance.now(); const list = await api(`/api/app/deal-flow?from=${today}&to=${today}`, ownerCookie); const listBody = await list.json(); const elapsed = performance.now() - started;
    check("the filtered grid pages a 10,000-row dataset within two seconds", list.status === 200 && listBody.total === 10000 && listBody.rows?.length === 100 && elapsed < 2000, `HTTP ${list.status}, rows ${listBody.rows?.length}, ${Math.round(elapsed)}ms`);
    check("grouping by partner totals matches the filtered rows", list.status === 200 && listBody.summary?.length === 1 && listBody.summary[0].partner_id === partnerA && listBody.summary[0].total === listBody.total);
    const csv = await api(`/api/app/deal-flow?from=${today}&to=${today}&format=csv`, ownerCookie); const csvText = await csv.text(); check("CSV export includes the complete filtered result and neutralizes formulas", csv.status === 200 && csvText.split("\r\n").length === 10002 && !csvText.includes("=CMD") && csvText.startsWith('"date"'));
    const target = listBody.rows.find((row) => row.manual_entry === true) ?? listBody.rows[0]; const patchPayload = { ...manualPayload, status: "completed", call_result: "sold", notes: "Updated QA note", local_date: today, monthly_premium_cents: 7200, face_amount_cents: 1200000, draft_date: today };
    const edit = await api(`/api/app/deal-flow/${target.id}`, ownerCookie, { method: "PATCH", ...json(patchPayload) }); check("editing disposition fields succeeds and writes audit", edit.status === 200); const auditEdit = await db.from("audit_log").select("id").eq("target_id", target.id).eq("action", "tenant.deal_flow_updated"); check("the edit has durable audit evidence", (auditEdit.data?.length ?? 0) >= 1);
    const concurrent = await Promise.all([api(`/api/app/deal-flow/${target.id}`, ownerCookie, { method: "PATCH", ...json({ ...patchPayload, notes: "Concurrent A" }) }), api(`/api/app/deal-flow/${target.id}`, ownerCookie, { method: "PATCH", ...json({ ...patchPayload, notes: "Concurrent B" }) })]); check("two simultaneous edits do not cross tenants or corrupt the row", concurrent.every((response) => response.status === 200));
    const hostile = await api(`/api/app/deal-flow/${target.id}`, ownerCookie, { method: "PATCH", ...json({ ...patchPayload, notes: "<script>alert(1)</script>" }) }); check("hostile free-text input is rejected before a write", hostile.status === 400);
    const crossTenant = await api(`/api/app/deal-flow/${target.id}`, otherCookie, { method: "PATCH", ...json(patchPayload) }); check("a different tenant cannot edit the row", crossTenant.status === 400);
    const missingDeal = await api(`/api/app/deal-flow/${randomUUID()}`, ownerCookie, { method: "PATCH", ...json(patchPayload) }); check("a missing deal dependency returns a controlled client error", missingDeal.status === 400);
    const assistant = await api("/api/app/deal-flow", assistantCookie); check("an assistant role is denied even with a valid session", assistant.status === 403);
    const missing = await api("/api/app/deal-flow"); const forged = await api("/api/app/deal-flow", "insurvas_tenant_session=forged"); const expired = await api("/api/app/deal-flow", await cookie(ownerA, tenantA, process.env.TENANT_SESSION_SECRET, true)); check("missing, forged, expired and wrong-secret sessions fail closed", missing.status === 401 && forged.status === 401 && expired.status === 401);
    const feature = await db.from("tenant_entitlements").select("entitlement").eq("tenant_id", tenantA).single(); const entitlement = feature.data?.entitlement; await db.from("tenant_entitlements").update({ entitlement: { ...entitlement, features: (entitlement.features ?? []).filter((item) => item !== "daily_deal_flow") } }).eq("tenant_id", tenantA); const noFeature = await api("/api/app/deal-flow", ownerCookie); check("the API rejects a valid user without the deal-flow entitlement", noFeature.status === 403); await db.from("tenant_entitlements").update({ entitlement }).eq("tenant_id", tenantA);
  } finally { await cleanup(); }
  console.log(failures ? `\n${failures} LA-1.13 verification check(s) FAILED.` : "\nAll LA-1.13 daily deal-flow checks passed."); return failures ? 1 : 0;
}
process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
