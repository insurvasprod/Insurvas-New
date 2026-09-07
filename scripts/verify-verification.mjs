// LA-1.11 live acceptance check. All fixture rows are disposable and removed in finally.
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID(); const ownerId = randomUUID(); const producerId = randomUUID(); const assistantId = randomUUID(); const partnerId = randomUUID();
let failures = 0; let templateCopyId = null; let leadId = null; let workItemId = null;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } };
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function token(userId, expired = false, secret = process.env.TENANT_SESSION_SECRET) { return new SignJWT({ tenantId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 1 : "10m").sign(new TextEncoder().encode(secret)); }
async function cookie(userId, expired = false, secret) { return `insurvas_tenant_session=${await token(userId, expired, secret)}`; }
async function api(path, sessionCookie, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie: sessionCookie, ...(options.headers ?? {}) }, redirect: "manual" }); }
function valueFor(field, index) {
  if (field.type === "number") return 65 + index;
  if (field.type === "currency") return 10000 + index;
  if (field.type === "date") return "1959-03-14";
  if (field.type === "phone") return "6025550101";
  if (field.type === "email") return "verification@example.test";
  if (field.type === "ssn") return "123456789";
  if (field.type === "boolean") return true;
  if (field.type === "single_select") return field.options[0] ?? "QA";
  if (field.type === "multi_select") return field.options.length ? [field.options[0]] : ["QA"];
  return `QA value ${index + 1}`;
}
function valuesFor(template) {
  const values = {};
  template.fields.forEach((field, index) => { values[field.field_key] = valueFor(field, index); });
  const textField = template.fields.find((field) => field.type === "text" || field.type === "long_text");
  if (textField) values[textField.field_key] = "Original QA Name";
  return { values, correctionKey: textField?.field_key ?? template.fields[0]?.field_key };
}
async function cleanup() {
  if (workItemId) await db.from("partner_messages").delete().eq("work_item_id", workItemId);
  if (leadId) {
    await db.from("active_calls").delete().eq("work_item_id", workItemId);
    await db.from("verification_sessions").delete().eq("work_item_id", workItemId);
    await db.from("lead_queue").delete().eq("id", workItemId);
    await db.from("agent_leads").delete().eq("id", leadId);
  }
  await db.from("audit_log").delete().in("actor_id", [ownerId, producerId, assistantId]);
  if (templateCopyId) await db.from("tenant_templates").delete().eq("id", templateCopyId);
  await db.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
  await db.from("tenant_users").delete().eq("tenant_id", tenantId);
  await db.from("partners").delete().eq("id", partnerId);
  await db.from("users").delete().in("id", [ownerId, producerId, assistantId]);
  await db.from("tenants").delete().eq("id", tenantId);
}
async function main() {
  if (!process.env.TENANT_SESSION_SECRET) throw new Error("TENANT_SESSION_SECRET is required");
  await cleanup();
  const tenant = await db.from("tenants").insert({ id: tenantId, name: `LA-1.11 QA ${stamp}`, status: "active", onboarding_state: "completed" }); if (tenant.error) throw new Error(tenant.error.message);
  const users = await db.from("users").insert([
    { id: ownerId, email: `la111-owner-${stamp}@invalid.test`, name: "LA-1.11 owner", password_hash: "verification-only", status: "active" },
    { id: producerId, email: `la111-producer-${stamp}@invalid.test`, name: "LA-1.11 producer", password_hash: "verification-only", status: "active" },
    { id: assistantId, email: `la111-assistant-${stamp}@invalid.test`, name: "LA-1.11 assistant", password_hash: "verification-only", status: "active" },
  ]); if (users.error) throw new Error(users.error.message);
  const memberships = await db.from("tenant_users").insert([{ tenant_id: tenantId, user_id: ownerId, role: "owner" }, { tenant_id: tenantId, user_id: producerId, role: "producer" }, { tenant_id: tenantId, user_id: assistantId, role: "assistant" }]); if (memberships.error) throw new Error(memberships.error.message);
  const entitlement = await db.from("tenant_entitlements").insert({ tenant_id: tenantId, entitlement: { tenant_id: tenantId, plan_code: "basic", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["inbound_transfers", "book_of_business"], meters: {}, limits: {} } }); if (entitlement.error) throw new Error(entitlement.error.message);
  const ownerCookie = await cookie(ownerId); const producerCookie = await cookie(producerId); const assistantCookie = await cookie(assistantId);
  try {
    const missing = await api(`/api/app/inbound/verification?work_item_id=${randomUUID()}`, ownerCookie); check("missing work item is rejected without a server error", missing.status === 404);
    const templatesResponse = await api("/api/app/templates", ownerCookie); const templatesBody = await templatesResponse.json(); templateCopyId = templatesBody.current?.tenant_template_id; const template = templatesBody.current?.template; check("agent form definition is available for the fixture", templatesResponse.status === 200 && templateCopyId && template?.form_definition?.sections?.length, `status ${templatesResponse.status}, body ${JSON.stringify(templatesBody).slice(0, 400)}`);
    if (!templateCopyId || !template) throw new Error("Fixture could not resolve an agent template");
    const pipeline = await db.from("pipelines").select("id").eq("tenant_id", tenantId).eq("partner_type", "publisher").eq("is_default", true).single(); const stage = pipeline.data ? await db.from("pipeline_stages").select("id").eq("pipeline_id", pipeline.data.id).eq("is_archived", false).order("position").limit(1).single() : { data: null, error: new Error("missing pipeline") }; if (pipeline.error || stage.error) throw new Error(pipeline.error?.message ?? stage.error?.message ?? "Fixture pipeline dependency missing");
    const prepared = valuesFor(template); const lead = await db.from("agent_leads").insert({ id: randomUUID(), tenant_id: tenantId, tenant_template_id: templateCopyId, template_id: templatesBody.current.assignment.template_id, template_version: templatesBody.current.assignment.template_version, definition_version: templatesBody.current.assignment.definition_version, product_line: template.product_code, pipeline_id: pipeline.data.id, stage_id: stage.data.id, values: prepared.values, created_by: ownerId, submission_id: randomUUID() }).select("id").single(); if (lead.error) throw new Error(lead.error.message); leadId = lead.data.id;
    const partner = await db.from("partners").insert({ id: partnerId, tenant_id: tenantId, name: `LA-1.11 Partner ${stamp}`, partner_type: "publisher", status: "active", timezone: "America/Phoenix" }).select("id").single(); if (partner.error) throw new Error(partner.error.message);
    const queue = await db.from("lead_queue").insert({ id: randomUUID(), tenant_id: tenantId, lead_id: leadId, partner_id: partnerId, product_line: template.product_code, pipeline_id: pipeline.data.id, stage_id: stage.data.id, status: "unclaimed" }).select("id").single(); if (queue.error) throw new Error(queue.error.message); workItemId = queue.data.id;
    const race = await Promise.all([api("/api/app/inbound/claim", ownerCookie, { method: "POST", ...json({ work_item_id: workItemId }) }), api("/api/app/inbound/claim", producerCookie, { method: "POST", ...json({ work_item_id: workItemId }) })]); const raceBodies = await Promise.all(race.map((response) => response.json())); const winnerIndex = race.findIndex((response) => response.status === 200); const loserIndex = race.findIndex((response) => response.status === 409); check("two claimants cannot verify one work item at once", winnerIndex >= 0 && loserIndex >= 0 && raceBodies[loserIndex]?.code === "already_claimed"); if (winnerIndex < 0) throw new Error("No claimant won the fixture race");
    const winnerId = winnerIndex === 0 ? ownerId : producerId; const winnerCookie = winnerIndex === 0 ? ownerCookie : producerCookie; const loserId = winnerIndex === 0 ? producerId : ownerId; const loserCookie = winnerIndex === 0 ? producerCookie : ownerCookie;
    const panelResponse = await api(`/api/app/inbound/verification?work_item_id=${workItemId}`, winnerCookie); const panel = await panelResponse.json(); check("claimed agent can load the dynamic verification panel", panelResponse.status === 200 && panel.session?.progress_percentage === 0 && panel.requiredCount >= 1 && panel.sections?.length >= 1);
    const correctionKey = prepared.correctionKey; const corrected = await api("/api/app/inbound/verification", winnerCookie, { method: "POST", ...json({ work_item_id: workItemId, field_key: correctionKey, state: "corrected", value: "Corrected QA Name" }) }); const correctedBody = await corrected.json(); const leadAfter = await db.from("agent_leads").select("values").eq("id", leadId).single(); const history = await db.from("verification_field_changes").select("old_value, new_value, actor_id").eq("lead_id", leadId).eq("field_key", correctionKey).order("created_at", { ascending: false }).limit(1).maybeSingle(); check("correction updates the lead and records old/new values", corrected.status === 200 && leadAfter.data?.values?.[correctionKey] === "Corrected QA Name" && history.data?.old_value === "Original QA Name" && history.data?.new_value === "Corrected QA Name" && history.data.actor_id === winnerId, `status ${corrected.status}, body ${JSON.stringify(correctedBody).slice(0, 500)}`);
    const auditRows = await db.from("audit_log").select("action, metadata").eq("actor_id", winnerId).eq("action", "tenant.verification_field_updated"); check("verification correction leaves an audit row", (auditRows.data ?? []).length >= 1 && auditRows.data[0].metadata?.fieldKey === correctionKey, `rows ${JSON.stringify(auditRows.data ?? []).slice(0, 500)}`);
    let current = correctedBody.panel ?? panel; const optional = current.sections.flatMap((section) => section.fields).find((field) => !field.is_required); if (optional) { const before = current.session.progress_percentage; const optionalResponse = await api("/api/app/inbound/verification", winnerCookie, { method: "POST", ...json({ work_item_id: workItemId, field_key: optional.field_key, state: "confirmed" }) }); const optionalBody = await optionalResponse.json(); check("optional confirmation does not change required-only progress", optionalResponse.status === 200 && optionalBody.panel.session.progress_percentage === before); current = optionalBody.panel; }
    for (const field of current.sections.flatMap((section) => section.fields).filter((item) => item.is_required && item.state === "outstanding")) { const response = await api("/api/app/inbound/verification", winnerCookie, { method: "POST", ...json({ work_item_id: workItemId, field_key: field.field_key, state: "confirmed" }) }); if (response.status !== 200) throw new Error(`Could not confirm ${field.field_key}: ${response.status}`); current = (await response.json()).panel; }
    check("progress reaches exactly 100 when all visible required fields are confirmed", current.session.progress_percentage === 100 && current.session.completed_at);
    const reset = await api("/api/app/inbound/verification", winnerCookie, { method: "POST", ...json({ work_item_id: workItemId, field_key: correctionKey, state: "outstanding" }) }); const resetBody = await reset.json(); check("marking a required field outstanding lowers progress and clears completion", reset.status === 200 && resetBody.panel.session.progress_percentage < 100 && !resetBody.panel.session.completed_at);
    await db.from("active_calls").update({ ended_at: new Date().toISOString() }).eq("work_item_id", workItemId).is("ended_at", null); const unclaim = await db.from("lead_queue").update({ status: "unclaimed", owner_user_id: null, claimed_by: null, owner_role: null, claimed_at: null }).eq("id", workItemId); if (unclaim.error) throw new Error(unclaim.error.message);
    const reclaimed = await api("/api/app/inbound/claim", loserCookie, { method: "POST", ...json({ work_item_id: workItemId }) }); check("a re-claim resumes the same session for the next agent", reclaimed.status === 200);
    const resumed = await api(`/api/app/inbound/verification?work_item_id=${workItemId}`, loserCookie); const resumedBody = await resumed.json(); const resumedLead = await db.from("agent_leads").select("values").eq("id", leadId).single(); check("reclaimed panel keeps prior correction and progress point", resumed.status === 200 && resumedLead.data?.values?.[correctionKey] === "Corrected QA Name" && resumedBody.lead?.values?.[correctionKey] === "Corrected QA Name" && resumedBody.session.progress_percentage < 100);
    const oldOwner = await api(`/api/app/inbound/verification?work_item_id=${workItemId}`, winnerCookie); check("previous claimant cannot keep writing after handoff", oldOwner.status === 403);
    const assistant = await api(`/api/app/inbound/verification?work_item_id=${workItemId}`, assistantCookie); const assistantPost = await api("/api/app/inbound/verification", assistantCookie, { method: "POST", ...json({ work_item_id: workItemId, field_key: correctionKey, state: "confirmed" }) }); check("assistant role is denied on both read and write", assistant.status === 403 && assistantPost.status === 403);
    const forged = await api(`/api/app/inbound/verification?work_item_id=${workItemId}`, await cookie(loserId, false, `${process.env.TENANT_SESSION_SECRET}-forged`)); const expired = await api(`/api/app/inbound/verification?work_item_id=${workItemId}`, await cookie(loserId, true)); check("forged and expired sessions fail closed", forged.status === 401 && expired.status === 401);
    const hostile = await api("/api/app/inbound/verification", loserCookie, { method: "POST", ...json({ work_item_id: workItemId, field_key: "<script>alert(1)</script>", state: "confirmed" }) }); check("hostile field keys are rejected before any write", hostile.status === 400);
  } finally { await cleanup(); }
  console.log(failures ? `\n${failures} verification check(s) FAILED.` : "\nAll LA-1.11 verification checks passed."); return failures ? 1 : 0;
}
process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
