// LA-1.10 live acceptance check. Creates disposable tenant data and drives the real agent routes.
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID(); const ownerId = randomUUID(); const producerId = randomUUID(); const assistantId = randomUUID(); const otherTenantId = randomUUID(); const otherOwnerId = randomUUID();
const createdLeadIds = []; const createdQueueIds = [];
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } };
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function session(userId, currentTenant = tenantId, expired = false) { return `insurvas_tenant_session=${await new SignJWT({ tenantId: currentTenant }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 1 : "10m").sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET))}`; }
async function api(path, cookie, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie, ...(options.headers ?? {}) }, redirect: "manual" }); }

async function cleanup() {
  for (const id of [tenantId, otherTenantId]) {
    const leads = await db.from("agent_leads").select("id").eq("tenant_id", id); const leadIds = (leads.data ?? []).map((row) => row.id);
    if (leadIds.length) {
      await db.from("partner_messages").delete().eq("tenant_id", id);
      await db.from("active_calls").delete().eq("tenant_id", id);
      await db.from("verification_sessions").delete().eq("tenant_id", id);
      await db.from("lead_queue").delete().in("lead_id", leadIds);
      await db.from("agent_leads").delete().in("id", leadIds);
    }
    await db.from("audit_log").delete().in("actor_id", [ownerId, producerId, assistantId, otherOwnerId]);
    await db.from("tenant_entitlements").delete().eq("tenant_id", id);
    await db.from("tenant_users").delete().eq("tenant_id", id);
    await db.from("users").delete().in("id", [ownerId, producerId, assistantId, otherOwnerId]);
    await db.from("tenants").delete().eq("id", id);
  }
}

async function main() {
  if (!process.env.TENANT_SESSION_SECRET) throw new Error("TENANT_SESSION_SECRET is required");
  await cleanup();
  const tenant = await db.from("tenants").insert([{ id: tenantId, name: `LA-1.10 QA ${stamp}`, status: "active", onboarding_state: "completed" }, { id: otherTenantId, name: `LA-1.10 other ${stamp}`, status: "active", onboarding_state: "completed" }]); if (tenant.error) throw new Error(tenant.error.message);
  const users = await db.from("users").insert([{ id: ownerId, email: `la110-owner-${stamp}@invalid.test`, name: "LA-1.10 owner", password_hash: "verification-only", status: "active" }, { id: producerId, email: `la110-producer-${stamp}@invalid.test`, name: "LA-1.10 producer", password_hash: "verification-only", status: "active" }, { id: assistantId, email: `la110-assistant-${stamp}@invalid.test`, name: "LA-1.10 assistant", password_hash: "verification-only", status: "active" }, { id: otherOwnerId, email: `la110-other-${stamp}@invalid.test`, name: "LA-1.10 other", password_hash: "verification-only", status: "active" }]); if (users.error) throw new Error(users.error.message);
  const members = await db.from("tenant_users").insert([{ tenant_id: tenantId, user_id: ownerId, role: "owner" }, { tenant_id: tenantId, user_id: producerId, role: "producer" }, { tenant_id: tenantId, user_id: assistantId, role: "assistant" }, { tenant_id: otherTenantId, user_id: otherOwnerId, role: "owner" }]); if (members.error) throw new Error(members.error.message);
  const entitlements = await db.from("tenant_entitlements").insert([{ tenant_id: tenantId, entitlement: { tenant_id: tenantId, plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["inbound_transfers"], meters: {}, limits: {} } }, { tenant_id: otherTenantId, entitlement: { tenant_id: otherTenantId, plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["inbound_transfers"], meters: {}, limits: {} } }]); if (entitlements.error) throw new Error(entitlements.error.message);
  const pipeline = await db.from("pipelines").select("id").eq("tenant_id", tenantId).eq("partner_type", "publisher").eq("is_default", true).single(); const stage = pipeline.data ? await db.from("pipeline_stages").select("id").eq("pipeline_id", pipeline.data.id).eq("is_archived", false).order("position").limit(1).single() : { data: null, error: new Error("no pipeline") }; const template = await db.from("templates").select("id").eq("product_code", "term_life").eq("is_active", true).limit(1).single(); if (pipeline.error || stage.error || template.error) throw new Error(pipeline.error?.message ?? stage.error?.message ?? template.error?.message ?? "Fixture dependency missing");
  const leadRows = Array.from({ length: 3 }, (_, index) => ({ id: randomUUID(), tenant_id: tenantId, template_id: template.data.id, template_version: 1, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, values: { full_name: `Inbox Prospect ${index + 1}`, age: 60 + index, state: index === 1 ? "NM" : "AZ" }, created_by: ownerId, submission_id: randomUUID() }));
  const leads = await db.from("agent_leads").insert(leadRows).select("id"); if (leads.error) throw new Error(leads.error.message); createdLeadIds.push(...(leads.data ?? []).map((row) => row.id));
  const partner = await db.from("partners").insert({ tenant_id: tenantId, name: `LA-1.10 Partner ${stamp}`, partner_type: "publisher", status: "active", timezone: "America/Phoenix" }).select("id").single(); if (partner.error) throw new Error(partner.error.message);
  const queues = await db.from("lead_queue").insert(createdLeadIds.map((leadId, index) => ({ id: randomUUID(), tenant_id: tenantId, lead_id: leadId, partner_id: index === 2 ? null : partner.data.id, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, queued_at: new Date(Date.now() - (3 - index) * 60_000).toISOString() }))).select("id, lead_id"); if (queues.error) throw new Error(queues.error.message); createdQueueIds.push(...(queues.data ?? []).map((row) => row.id));
  const bulkLeadRows = Array.from({ length: 500 }, (_, index) => ({ id: randomUUID(), tenant_id: tenantId, template_id: template.data.id, template_version: 1, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, values: { full_name: `Bulk Inbox Prospect ${index + 1}`, age: 70, state: "AZ" }, created_by: ownerId, submission_id: randomUUID() }));
  const bulkLeads = await db.from("agent_leads").insert(bulkLeadRows).select("id"); if (bulkLeads.error) throw new Error(bulkLeads.error.message); createdLeadIds.push(...(bulkLeads.data ?? []).map((row) => row.id));
  const bulkQueues = await db.from("lead_queue").insert((bulkLeads.data ?? []).map((row) => ({ id: randomUUID(), tenant_id: tenantId, lead_id: row.id, partner_id: partner.data.id, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id }))).select("id"); if (bulkQueues.error) throw new Error(bulkQueues.error.message); createdQueueIds.push(...(bulkQueues.data ?? []).map((row) => row.id));
  const owner = await session(ownerId); const producer = await session(producerId); const assistant = await session(assistantId); const otherOwner = await session(otherOwnerId, otherTenantId); const expiredOwner = await session(ownerId, tenantId, true);
  try {
    const inboxStart = Date.now(); const inbox = await api("/api/app/inbound", owner); const inboxBody = await inbox.json(); const inboxDuration = Date.now() - inboxStart; check("inbox returns oldest-first transfer rows and filter options", inbox.status === 200 && inboxBody.items?.length === 500 && inboxBody.items[0].customer === "Inbox Prospect 1" && inboxBody.items[0].partnerName.includes("LA-1.10 Partner"), `status ${inbox.status}, body ${JSON.stringify(inboxBody).slice(0, 400)}`); check("inbox loads 500 unclaimed transfers in under one second", inbox.status === 200 && inboxDuration < 1000, `${inboxDuration}ms`); console.log(`  info inbox latency: ${inboxDuration}ms`);
    const filtered = await api("/api/app/inbound?state=NM&screening_outcome=not_checked", owner); const filteredBody = await filtered.json(); check("partner, product, state and screening filters are server-applied", filtered.status === 200 && filteredBody.items?.length === 1 && filteredBody.items[0].state === "NM");
    const races = await Promise.all([api("/api/app/inbound/claim", owner, { method: "POST", ...json({ work_item_id: createdQueueIds[0] }) }), api("/api/app/inbound/claim", producer, { method: "POST", ...json({ work_item_id: createdQueueIds[0] }) })]); const raceBodies = await Promise.all(races.map((response) => response.json())); const winnerCount = races.filter((response) => response.status === 200).length; const loser = raceBodies.find((body, index) => races[index].status === 409); const stored = await db.from("lead_queue").select("status, owner_user_id, claimed_by").eq("id", createdQueueIds[0]).single(); const callCount = await db.from("active_calls").select("id", { count: "exact", head: true }).eq("work_item_id", createdQueueIds[0]).is("ended_at", null); check("two simultaneous claims produce one winner, one clear conflict and one active call", winnerCount === 1 && races.some((response) => response.status === 409) && loser?.error?.includes("already claimed") && stored.data?.status === "claimed" && stored.data.owner_user_id === stored.data.claimed_by && callCount.count === 1, `statuses ${races.map((response) => response.status).join(",")}`);
    const afterClaim = await api("/api/app/inbound", producer); const afterBody = await afterClaim.json(); check("claimed lead disappears from the default inbox after refresh", afterClaim.status === 200 && !afterBody.items?.some((item) => item.id === createdQueueIds[0]));
    const chatFailure = await api("/api/app/inbound/claim", owner, { method: "POST", ...json({ work_item_id: createdQueueIds[2] }) }); const chatBody = await chatFailure.json(); const chatCall = await db.from("active_calls").select("id").eq("work_item_id", createdQueueIds[2]).is("ended_at", null).maybeSingle(); check("partner chat failure does not roll back a successful claim", chatFailure.status === 200 && chatBody.chatPosted === false && chatBody.claim?.active_call_id === chatCall.data?.id);
    await db.from("lead_queue").update({ status: "unclaimed", owner_user_id: null, claimed_by: null, owner_role: null, claimed_at: null }).eq("id", createdQueueIds[1]); await db.from("active_calls").insert({ tenant_id: tenantId, work_item_id: createdQueueIds[1], lead_id: createdLeadIds[1], user_id: ownerId, agent_role: "owner", started_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() }); const reclaimed = await api("/api/app/inbound/claim", owner, { method: "POST", ...json({ work_item_id: createdQueueIds[1] }) }); const reclaimedBody = await reclaimed.json(); const openCalls = await db.from("active_calls").select("id, ended_at", { count: "exact" }).eq("work_item_id", createdQueueIds[1]); check("re-claim closes a stale dropped call and opens a fresh active call", reclaimed.status === 200 && openCalls.count === 2 && openCalls.data?.filter((call) => call.ended_at === null).length === 1 && reclaimedBody.claim?.active_call_id);
    const crossTenant = await api("/api/app/inbound", otherOwner); const crossBody = await crossTenant.json(); check("tenant scope prevents another tenant from seeing this inbox", crossTenant.status === 200 && crossBody.items?.length === 0);
    const assistantAccess = await api("/api/app/inbound", assistant); const assistantClaim = await api("/api/app/inbound/claim", assistant, { method: "POST", ...json({ work_item_id: createdQueueIds[1] }) }); check("assistant role cannot read or claim transfer inbox", assistantAccess.status === 403 && assistantClaim.status === 403);
    const forged = await api("/api/app/inbound", "insurvas_tenant_session=forged"); check("forged session fails closed", forged.status === 401);
    const expired = await api("/api/app/inbound", expiredOwner); check("expired session fails closed", expired.status === 401);
    const hostile = await api("/api/app/inbound?product_line=%3Cscript%3Ealert(1)%3C%2Fscript%3E", owner); check("hostile filter input is rejected", hostile.status === 400);
    const audits = await db.from("audit_log").select("action").eq("actor_id", ownerId).in("action", ["tenant.transfer_claimed", "tenant.transfer_claim_chat_failed"]); check("claim and best-effort chat failure leave audit evidence", (audits.data ?? []).length >= 3);
  } finally { await cleanup(); }
  console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll LA-1.10 transfer inbox checks passed."); return failures ? 1 : 0;
}
process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
