// LA-1.20 live contract checks. Every fixture row is disposable and removed in finally.
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID();
const otherTenantId = randomUUID();
const ownerId = randomUUID();
const bookkeeperId = randomUUID();
const otherOwnerId = randomUUID();
const partnerId = randomUUID();
let leadId = null;
let workItemId = null;
let templateCopyId = null;
let failures = 0;

const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } };
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function tenantToken(userId, tenant = tenantId, expired = false, secret = process.env.TENANT_SESSION_SECRET) {
  return new SignJWT({ tenantId: tenant }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 1 : "10m").sign(new TextEncoder().encode(secret));
}
async function agentCookie(userId, tenant = tenantId, expired = false, secret) {
  return `insurvas_tenant_session=${await tenantToken(userId, tenant, expired, secret ?? process.env.TENANT_SESSION_SECRET)}`;
}
async function partnerCookie() {
  const secret = process.env.PARTNER_SESSION_SECRET || `insurvas-partner:${process.env.TENANT_SESSION_SECRET}`;
  const token = await new SignJWT({ tenantId, partnerId }).setProtectedHeader({ alg: "HS256" }).setSubject(ownerId).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(secret));
  return `insurvas_partner_session=${token}`;
}
async function api(path, cookie, options = {}) {
  return fetch(`${BASE}${path}`, { ...options, headers: { cookie, ...(options.headers ?? {}) }, redirect: "manual" });
}
function valueFor(field, index) {
  if (field.type === "number") return 65 + index;
  if (field.type === "currency") return 10000 + index;
  if (field.type === "date") return "1959-03-14";
  if (field.type === "phone") return "6025550101";
  if (field.type === "email") return "la120@example.test";
  if (field.type === "ssn") return "123456789";
  if (field.type === "boolean") return true;
  if (field.type === "single_select") return field.options[0] ?? "QA";
  if (field.type === "multi_select") return field.options.length ? [field.options[0]] : ["QA"];
  return `LA-1.20 QA value ${index + 1}`;
}
function valuesFor(template) {
  const values = {};
  template.fields.forEach((field, index) => { values[field.field_key] = valueFor(field, index); });
  const textField = template.fields.find((field) => field.type === "text" || field.type === "long_text");
  if (textField) values[textField.field_key] = "Original LA-1.20 Name";
  return { values, correctionKey: textField?.field_key ?? template.fields[0]?.field_key };
}
async function cleanup() {
  if (workItemId) {
    await db.from("partner_messages").delete().eq("work_item_id", workItemId);
    await db.from("active_calls").delete().eq("work_item_id", workItemId);
    await db.from("verification_sessions").delete().eq("work_item_id", workItemId);
    await db.from("lead_queue").delete().eq("id", workItemId);
  }
  if (leadId) {
    await db.from("verification_field_changes").delete().eq("lead_id", leadId);
    await db.from("agent_leads").delete().eq("id", leadId);
  }
  await db.from("audit_log").delete().in("actor_id", [ownerId, bookkeeperId, otherOwnerId]);
  if (templateCopyId) await db.from("tenant_templates").delete().eq("id", templateCopyId);
  await db.from("tenant_entitlements").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("tenant_users").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("partners").delete().eq("id", partnerId);
  await db.from("users").delete().in("id", [ownerId, bookkeeperId, otherOwnerId]);
  await db.from("tenants").delete().in("id", [tenantId, otherTenantId]);
}
async function main() {
  if (!process.env.TENANT_SESSION_SECRET) throw new Error("TENANT_SESSION_SECRET is required");
  await cleanup();
  const tenants = await db.from("tenants").insert([
    { id: tenantId, name: `LA-1.20 QA ${stamp}`, status: "active", onboarding_state: "completed" },
    { id: otherTenantId, name: `LA-1.20 isolation ${stamp}`, status: "active", onboarding_state: "completed" },
  ]);
  if (tenants.error) throw new Error(tenants.error.message);
  const users = await db.from("users").insert([
    { id: ownerId, email: `la120-owner-${stamp}@invalid.test`, name: "LA-1.20 owner", password_hash: "workspace-only", status: "active" },
    { id: bookkeeperId, email: `la120-bookkeeper-${stamp}@invalid.test`, name: "LA-1.20 bookkeeper", password_hash: "workspace-only", status: "active" },
    { id: otherOwnerId, email: `la120-other-${stamp}@invalid.test`, name: "LA-1.20 other tenant", password_hash: "workspace-only", status: "active" },
  ]);
  if (users.error) throw new Error(users.error.message);
  const memberships = await db.from("tenant_users").insert([
    { tenant_id: tenantId, user_id: ownerId, role: "owner" },
    { tenant_id: tenantId, user_id: bookkeeperId, role: "bookkeeper" },
    { tenant_id: otherTenantId, user_id: otherOwnerId, role: "owner" },
  ]);
  if (memberships.error) throw new Error(memberships.error.message);
  const entitlements = await db.from("tenant_entitlements").insert([
    { tenant_id: tenantId, entitlement: { tenant_id: tenantId, plan_code: "basic", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["book_of_business", "inbound_transfers"], meters: {}, limits: {} } },
    { tenant_id: otherTenantId, entitlement: { tenant_id: otherTenantId, plan_code: "basic", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["book_of_business"], meters: {}, limits: {} } },
  ]);
  if (entitlements.error) throw new Error(entitlements.error.message);
  const ownerCookie = await agentCookie(ownerId);
  const bookkeeperCookie = await agentCookie(bookkeeperId);
  const otherCookie = await agentCookie(otherOwnerId, otherTenantId);
  try {
    const templatesResponse = await api("/api/app/templates", ownerCookie);
    const templatesBody = await templatesResponse.json();
    templateCopyId = templatesBody.current?.tenant_template_id;
    const template = templatesBody.current?.template;
    check("generic form definition is available", templatesResponse.status === 200 && Boolean(templateCopyId) && Boolean(template?.form_definition?.sections?.length), `status ${templatesResponse.status}`);
    if (!templateCopyId || !template) throw new Error("Fixture could not resolve an agent template");
    const pipeline = await db.from("pipelines").select("id").eq("tenant_id", tenantId).eq("partner_type", "publisher").eq("is_default", true).single();
    const stages = pipeline.data ? await db.from("pipeline_stages").select("id").eq("pipeline_id", pipeline.data.id).eq("is_archived", false).order("position") : { data: [], error: new Error("missing pipeline") };
    if (pipeline.error || stages.error || !stages.data?.length) throw new Error(pipeline.error?.message ?? stages.error?.message ?? "Fixture pipeline dependency missing");
    const prepared = valuesFor(template);
    if (!prepared.correctionKey) throw new Error("Fixture template has no field to correct");
    const lead = await db.from("agent_leads").insert({ id: randomUUID(), tenant_id: tenantId, tenant_template_id: templateCopyId, template_id: templatesBody.current.assignment.template_id, template_version: templatesBody.current.assignment.template_version, definition_version: templatesBody.current.assignment.definition_version, product_line: template.product_code, pipeline_id: pipeline.data.id, stage_id: stages.data[0].id, values: prepared.values, created_by: ownerId, submission_id: randomUUID() }).select("id").single();
    if (lead.error) throw new Error(lead.error.message);
    leadId = lead.data.id;
    const partner = await db.from("partners").insert({ id: partnerId, tenant_id: tenantId, name: `LA-1.20 partner ${stamp}`, partner_type: "publisher", status: "active", timezone: "America/Phoenix" });
    if (partner.error) throw new Error(partner.error.message);
    const queue = await db.from("lead_queue").insert({ id: randomUUID(), tenant_id: tenantId, lead_id: leadId, partner_id: partnerId, product_line: template.product_code, pipeline_id: pipeline.data.id, stage_id: stages.data[0].id, status: "unclaimed" }).select("id").single();
    if (queue.error) throw new Error(queue.error.message);
    workItemId = queue.data.id;

    const detailBefore = await api(`/api/app/leads/${leadId}`, ownerCookie);
    const detailBeforeBody = await detailBefore.json();
    check("owner can open the unified workspace", detailBefore.status === 200 && detailBeforeBody.lead?.id === leadId && detailBeforeBody.template?.form_definition && detailBeforeBody.queue?.id === workItemId, `status ${detailBefore.status}`);
    const wrongRole = await api(`/api/app/leads/${leadId}`, bookkeeperCookie);
    const concurrentReads = await Promise.all([api(`/api/app/leads/${leadId}`, ownerCookie), api(`/api/app/leads/${leadId}`, ownerCookie)]);
    check("bookkeeper role is denied on the workspace API", wrongRole.status === 403);
    check("two simultaneous workspace reads remain isolated and successful", concurrentReads.every((response) => response.status === 200));
    check("submitted form is rendered from the stored generic template", detailBefore.status === 200 && detailBeforeBody.template.fields.some((field) => field.field_key === prepared.correctionKey));
    check("initial timeline includes submission", detailBefore.status === 200 && detailBeforeBody.timeline.some((event) => event.label === "Lead Submitted" && event.immutable === true));

    const claim = await api("/api/app/inbound/claim", ownerCookie, { method: "POST", ...json({ work_item_id: workItemId }) });
    check("workspace actions can claim the lead", claim.status === 200);
    const correction = await api("/api/app/inbound/verification", ownerCookie, { method: "POST", ...json({ work_item_id: workItemId, field_key: prepared.correctionKey, state: "corrected", value: "Corrected LA-1.20 Name" }) });
    check("verification correction succeeds from the shared work item", correction.status === 200);
    const detailAfterCorrection = await api(`/api/app/leads/${leadId}`, ownerCookie);
    const correctedBody = await detailAfterCorrection.json();
    const correctionRecord = correctedBody.corrections?.find((change) => change.field_key === prepared.correctionKey);
    check("verification correction is shown alongside original value", detailAfterCorrection.status === 200 && correctionRecord?.old_value === "Original LA-1.20 Name" && correctionRecord?.new_value === "Corrected LA-1.20 Name");
    check("timeline contains immutable verification correction", detailAfterCorrection.status === 200 && correctedBody.timeline.some((event) => event.label === "Verification Correction" && event.immutable === true));

    const nextStageId = stages.data[1]?.id ?? stages.data[0].id;
    const stageUpdates = await Promise.all([api(`/api/app/leads/${leadId}`, ownerCookie, { method: "PATCH", ...json({ values: correctedBody.lead.values, stage_id: nextStageId }) }), api(`/api/app/leads/${leadId}`, ownerCookie, { method: "PATCH", ...json({ values: correctedBody.lead.values, stage_id: nextStageId }) })]);
    check("workspace can change stage through the existing action", stageUpdates.every((response) => response.status === 200));
    const detailAfterStage = await api(`/api/app/leads/${leadId}`, ownerCookie);
    const stagedBody = await detailAfterStage.json();
    check("stage change is reflected and appears in timeline", detailAfterStage.status === 200 && stagedBody.lead.stage_id === nextStageId && stagedBody.timeline.some((event) => event.label === "Lead Stage Changed" && event.immutable === true));

    const isolated = await api(`/api/app/leads/${leadId}`, otherCookie);
    check("another tenant cannot open the lead workspace", isolated.status === 404);
    const missingLead = await api(`/api/app/leads/${randomUUID()}`, ownerCookie);
    check("a valid session gets a controlled not-found for a missing lead", missingLead.status === 404);
    const expired = await api(`/api/app/leads/${leadId}`, await agentCookie(ownerId, tenantId, true));
    const forged = await api(`/api/app/leads/${leadId}`, await agentCookie(ownerId, tenantId, false, `${process.env.TENANT_SESSION_SECRET}-forged`));
    check("expired and forged agent sessions fail closed", expired.status === 401 && forged.status === 401);
    const hostile = await api("/api/app/leads/not-a-uuid", ownerCookie);
    check("hostile lead identifiers return a controlled client error", hostile.status === 400);
    const partnerPage = await fetch(`${BASE}/app/leads/${leadId}`, { headers: { cookie: await partnerCookie() }, redirect: "manual" });
    check("partner session is redirected to the partner surface", [307, 308].includes(partnerPage.status) && partnerPage.headers.get("location") === "/partner", `status ${partnerPage.status}, location ${partnerPage.headers.get("location")}`);
    const partnerApi = await api(`/api/app/leads/${leadId}`, await partnerCookie());
    check("partner session cannot call the agent workspace API", partnerApi.status === 401);
  } finally {
    await cleanup();
  }
  console.log(failures ? `\n${failures} LA-1.20 check(s) FAILED.` : "\nAll LA-1.20 lead workspace checks passed.");
  return failures ? 1 : 0;
}
process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
