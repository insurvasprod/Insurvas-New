// LA-1.7 live acceptance check. Fixtures are disposable and exercise the real partner API.
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now(); const tenantId = randomUUID(); const ownerId = randomUUID(); const partnerId = randomUUID(); const partnerUserId = randomUUID(); const vendorIds = [];
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } };
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const cookie = (name, token) => `${name}=${token}`;
async function token(secret, userId, payload) { return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(secret)); }
async function api(path, requestCookie, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie: requestCookie, ...(options.headers ?? {}) }, redirect: "manual" }); }
function startVendorSimulator() {
  const server = createServer((request, response) => { request.on("end", () => { response.setHeader("content-type", "application/json"); response.statusCode = 200; response.end(JSON.stringify((request.url ?? "").includes("dnc") ? { listed: false } : { hit: false })); }); request.resume(); });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

async function cleanup() {
  const leads = await db.from("agent_leads").select("id").eq("tenant_id", tenantId); const leadIds = (leads.data ?? []).map((row) => row.id);
  if (leadIds.length) { await db.from("intake_alerts").delete().eq("tenant_id", tenantId); await db.from("intake_failures").delete().in("lead_id", leadIds); await db.from("lead_notifications").delete().in("lead_id", leadIds); await db.from("lead_queue").delete().in("lead_id", leadIds); await db.from("deal_flow").delete().in("lead_id", leadIds); }
  await db.from("form_drafts").delete().eq("tenant_id", tenantId); await db.from("agent_leads").delete().eq("tenant_id", tenantId); await db.from("partner_products").delete().eq("partner_id", partnerId); await db.from("partner_users").delete().eq("partner_id", partnerId); await db.from("partners").delete().eq("id", partnerId); await db.from("tenant_products").delete().eq("tenant_id", tenantId); await db.from("tenant_templates").delete().eq("tenant_id", tenantId); await db.from("tenant_entitlements").delete().eq("tenant_id", tenantId); await db.from("subscriptions").delete().eq("tenant_id", tenantId); await db.from("tenant_users").delete().eq("tenant_id", tenantId); await db.from("users").delete().in("id", [ownerId, partnerUserId]); await db.from("tenants").delete().eq("id", tenantId); if (vendorIds.length) await db.from("compliance_vendors").delete().in("id", vendorIds);
}

function valuesFor(template, phone, fullName = "LA-1.7 Prospect") {
  const output = {}; const required = new Set(template.form_definition.sections.flatMap((section) => section.fields.filter((field) => field.is_required).map((field) => field.field_key)));
  for (const field of template.fields) {
    if (!field.is_required && !required.has(field.field_key)) continue;
    output[field.field_key] = field.type === "number" || field.type === "currency" ? 1 : field.type === "date" ? "1990-01-01" : field.type === "phone" ? phone : field.type === "email" ? "qa@example.com" : field.type === "ssn" ? "123456789" : field.type === "boolean" ? true : field.type === "single_select" ? field.options[0] ?? "AZ" : field.type === "multi_select" ? [field.options[0] ?? "QA"] : field.field_key === "full_name" ? fullName : field.field_key === "first_name" ? fullName.split(" ")[0] : field.field_key === "last_name" ? fullName.split(" ").slice(1).join(" ") : "LA-1.7 value";
  }
  for (const field of template.fields) if (field.type === "phone") output[field.field_key] = phone;
  for (const key of ["full_name", "name"]) if (template.fields.some((field) => field.field_key === key)) output[key] = fullName;
  return output;
}

async function main() {
  await cleanup(); const simulator = await startVendorSimulator();
  try {
    const tenant = await db.from("tenants").insert({ id: tenantId, name: `LA-1.7 QA ${stamp}`, status: "active", onboarding_state: "completed" }); if (tenant.error) throw new Error(tenant.error.message);
    const users = await db.from("users").insert([{ id: ownerId, email: `la17-owner-${stamp}@invalid.test`, name: "LA-1.7 owner", password_hash: "verification-only", status: "active" }, { id: partnerUserId, email: `la17-partner-${stamp}@invalid.test`, name: "LA-1.7 partner", password_hash: "verification-only", status: "active" }]); if (users.error) throw new Error(users.error.message);
    const member = await db.from("tenant_users").insert({ tenant_id: tenantId, user_id: ownerId, role: "owner" }); if (member.error) throw new Error(member.error.message);
    const plan = await db.from("plans").select("id").eq("code", "advance").eq("version", 1).single(); if (plan.error) throw new Error(plan.error.message);
    const sub = await db.rpc("admin_assign_subscription", { p_tenant_id: tenantId, p_plan_id: plan.data.id, p_billing_cycle: "monthly", p_start: new Date().toISOString() }); if (sub.error) throw new Error(sub.error.message);
    const entitlement = await db.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId }); if (entitlement.error) throw new Error(entitlement.error.message);
    const serverBase = `http://127.0.0.1:${simulator.port}`; const vendors = await db.from("compliance_vendors").insert([{ name: `LA17 litigator ${stamp}`, vendor_type: "litigator_scrub", endpoint: `${serverBase}/litigator`, is_enabled: true, priority: 1, cost_per_lookup_cents: 1 }, { name: `LA17 dnc ${stamp}`, vendor_type: "dnc_scrub", endpoint: `${serverBase}/dnc`, is_enabled: true, priority: 1, cost_per_lookup_cents: 1 }]).select("id"); if (vendors.error) throw new Error(vendors.error.message); vendorIds.push(...(vendors.data ?? []).map((row) => row.id));
    const partner = await db.from("partners").insert({ id: partnerId, tenant_id: tenantId, name: `LA-1.7 partner ${stamp}`, partner_type: "publisher", status: "active", timezone: "Pacific/Honolulu" }); if (partner.error) throw new Error(partner.error.message);
    const partnerMember = await db.from("partner_users").insert({ id: randomUUID(), tenant_id: tenantId, partner_id: partnerId, user_id: partnerUserId, role: "partner_user", status: "active", accepted_at: new Date().toISOString() }); if (partnerMember.error) throw new Error(partnerMember.error.message);
    const product = await db.from("tenant_products").upsert({ tenant_id: tenantId, product_code: "term_life", is_enabled: true }); if (product.error) throw new Error(product.error.message); const approval = await db.from("partner_products").insert({ partner_id: partnerId, product_code: "term_life" }); if (approval.error) throw new Error(approval.error.message);
    const agentSecret = process.env.TENANT_SESSION_SECRET; const partnerSecret = process.env.PARTNER_SESSION_SECRET ?? `insurvas-partner:${agentSecret}`; if (!agentSecret) throw new Error("TENANT_SESSION_SECRET is required");
    const owner = cookie("insurvas_tenant_session", await token(agentSecret, ownerId, { tenantId })); const portal = cookie("insurvas_partner_session", await token(partnerSecret, partnerUserId, { tenantId, partnerId }));
    const provisioned = await api("/api/app/templates", owner); if (provisioned.status !== 200) throw new Error(`Could not provision form (HTTP ${provisioned.status})`);
    const formResponse = await api("/api/partner/forms/term_life", portal); const formBody = await formResponse.json(); const template = formBody?.template?.template; if (!template) throw new Error(`Could not load form (HTTP ${formResponse.status})`);

    const values = valuesFor(template, "6025550107", "Initial Prospect"); const submissionId = randomUUID();
    const submitted = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", submission_id: submissionId, values }) }); const submittedBody = await submitted.json(); const lead = submittedBody.lead;
    const queue = await db.from("lead_queue").select("id, product_line, status").eq("lead_id", lead?.id).maybeSingle(); const deal = await db.from("deal_flow").select("id, product_line, insured_name, local_date").eq("lead_id", lead?.id).maybeSingle(); const notification = await db.from("lead_notifications").select("id, status").eq("lead_id", lead?.id).maybeSingle();
    const expectedDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Honolulu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    check("one accepted submission creates lead, work item, partial deal-flow row and queued notification", submitted.status === 201 && lead?.product_line === "term_life" && queue.data?.product_line === "term_life" && queue.data?.status === "unclaimed" && deal.data?.product_line === "term_life" && deal.data?.insured_name === "Initial Prospect" && deal.data?.local_date === expectedDate && notification.data?.status === "queued", `status ${submitted.status}, error ${submittedBody?.error ?? "none"}`);

    const updatedValues = valuesFor(template, "6025550107", "Updated Prospect"); const replay = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", submission_id: submissionId, values: updatedValues }) }); const replayBody = await replay.json(); const replayLead = await db.from("agent_leads").select("values").eq("id", lead?.id).maybeSingle(); const replayDeal = await db.from("deal_flow").select("insured_name").eq("lead_id", lead?.id).maybeSingle(); const replayCounts = await Promise.all([db.from("lead_queue").select("id", { count: "exact", head: true }).eq("lead_id", lead?.id), db.from("lead_notifications").select("id", { count: "exact", head: true }).eq("lead_id", lead?.id)]);
    check("resubmitting the same draft updates one lead and repairs without duplicating artifacts", replay.status === 200 && replayBody.replayed === true && replayLead.data?.values?.full_name === "Updated Prospect" && replayDeal.data?.insured_name === "Updated Prospect" && replayCounts[0].count === 1 && replayCounts[1].count === 1);

    await db.from("lead_queue").delete().eq("lead_id", lead.id); const orphanRun = spawnSync(process.execPath, ["scripts/reconcile-intake.mjs"], { env: process.env, encoding: "utf8" }); check("reconciliation reports a lead with no work item or logged failure", orphanRun.status === 1 && orphanRun.stdout.includes(lead.id) === false && orphanRun.stderr.includes(lead.id));
    const failure = await db.from("intake_failures").insert({ tenant_id: tenantId, lead_id: lead.id, step: "work_item", error_message: "Forced work-item dependency failure", metadata: { test: true } }).select("id").single(); const alert = failure.data ? await db.from("intake_alerts").select("id, status", { count: "exact" }).eq("intake_failure_id", failure.data.id).maybeSingle() : { data: null, count: 0 };
    const recoveredRun = spawnSync(process.execPath, ["scripts/reconcile-intake.mjs"], { env: process.env, encoding: "utf8" }); check("a durable failure record creates an open alert and satisfies reconciliation", !failure.error && alert.data?.status === "open" && alert.count === 1 && recoveredRun.status === 0);
    const requeue = await db.from("lead_queue").insert({ tenant_id: tenantId, lead_id: lead.id, partner_id: partnerId, product_line: "term_life", stage_key: lead.stage_key }); check("the missing work item can be repaired without a second lead", !requeue.error);

    const audits = await db.from("audit_log").select("action").eq("actor_id", partnerUserId).eq("action", "tenant.partner_lead_submitted"); check("submission writes leave audit evidence", (audits.data ?? []).length >= 2);
  } finally { await new Promise((resolve) => simulator.server.close(resolve)); await cleanup(); }
  console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll LA-1.7 intake pipeline checks passed."); return failures ? 1 : 0;
}

process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
