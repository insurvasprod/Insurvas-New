// LA-1.15 acceptance and failure-path verification. Uses disposable tenants and the real app API.
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const realtime = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } }) : null;
const stamp = Date.now();
const tenantId = randomUUID(); const otherTenantId = randomUUID();
const ownerId = randomUUID(); const assistantId = randomUUID(); const bookkeeperId = randomUUID(); const otherOwnerId = randomUUID();
const leadId = randomUUID(); const queueId = randomUUID();
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } };
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function cookie(userId, currentTenant = tenantId, expired = false) { return `insurvas_tenant_session=${await new SignJWT({ tenantId: currentTenant }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 1 : "10m").sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET))}`; }
async function api(path, sessionCookie, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie: sessionCookie, ...(options.headers ?? {}) }, redirect: "manual" }); }

async function cleanup() {
  for (const id of [tenantId, otherTenantId]) {
    await db.from("agent_floor_nudges").delete().eq("tenant_id", id);
    await db.from("agent_presence").delete().eq("tenant_id", id);
    await db.from("active_calls").delete().eq("tenant_id", id);
    await db.from("lead_queue").delete().eq("tenant_id", id);
    await db.from("agent_leads").delete().eq("tenant_id", id);
    await db.from("audit_log").delete().in("actor_id", [ownerId, assistantId, bookkeeperId, otherOwnerId]);
    await db.from("tenant_entitlements").delete().eq("tenant_id", id);
    await db.from("tenant_users").delete().eq("tenant_id", id);
    await db.from("users").delete().in("id", [ownerId, assistantId, bookkeeperId, otherOwnerId]);
    await db.from("tenants").delete().eq("id", id);
  }
}

async function main() {
  if (!process.env.TENANT_SESSION_SECRET) throw new Error("TENANT_SESSION_SECRET is required");
  await cleanup();
  const tenants = await db.from("tenants").insert([
    { id: tenantId, name: `LA-1.15 Floor QA ${stamp}`, status: "active", onboarding_state: "completed" },
    { id: otherTenantId, name: `LA-1.15 Other ${stamp}`, status: "active", onboarding_state: "completed" },
  ]);
  if (tenants.error) throw new Error(tenants.error.message);
  const users = await db.from("users").insert([
    { id: ownerId, email: `la115-owner-${stamp}@invalid.test`, name: "Floor Owner", password_hash: "verification-only", status: "active" },
    { id: assistantId, email: `la115-assistant-${stamp}@invalid.test`, name: "Floor Assistant", password_hash: "verification-only", status: "active" },
    { id: bookkeeperId, email: `la115-bookkeeper-${stamp}@invalid.test`, name: "Floor Bookkeeper", password_hash: "verification-only", status: "active" },
    { id: otherOwnerId, email: `la115-other-${stamp}@invalid.test`, name: "Other Owner", password_hash: "verification-only", status: "active" },
  ]);
  if (users.error) throw new Error(users.error.message);
  const members = await db.from("tenant_users").insert([
    { tenant_id: tenantId, user_id: ownerId, role: "owner" }, { tenant_id: tenantId, user_id: assistantId, role: "assistant" }, { tenant_id: tenantId, user_id: bookkeeperId, role: "bookkeeper" }, { tenant_id: otherTenantId, user_id: otherOwnerId, role: "owner" },
  ]);
  if (members.error) throw new Error(members.error.message);
  const grants = { tenant_id: tenantId, entitlement: { tenant_id: tenantId, plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["inbound_transfers"], meters: {}, limits: {} } };
  const otherGrant = { tenant_id: otherTenantId, entitlement: { tenant_id: otherTenantId, plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["inbound_transfers"], meters: {}, limits: {} } };
  const entitlements = await db.from("tenant_entitlements").insert([grants, otherGrant]); if (entitlements.error) throw new Error(entitlements.error.message);
  const pipeline = await db.from("pipelines").select("id").eq("tenant_id", tenantId).eq("partner_type", "publisher").eq("is_default", true).single();
  const stage = await db.from("pipeline_stages").select("id").eq("pipeline_id", pipeline.data.id).eq("is_archived", false).order("position").limit(1).single();
  const template = await db.from("templates").select("id").eq("product_code", "term_life").eq("is_active", true).limit(1).single();
  if (pipeline.error || stage.error || template.error) throw new Error(pipeline.error?.message ?? stage.error?.message ?? template.error?.message ?? "Fixture dependency missing");
  const lead = await db.from("agent_leads").insert({ id: leadId, tenant_id: tenantId, template_id: template.data.id, template_version: 1, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, values: { full_name: "Floor Prospect", age: 67, state: "AZ" }, created_by: ownerId, submission_id: randomUUID() }); if (lead.error) throw new Error(lead.error.message);
  const queue = await db.from("lead_queue").insert({ id: queueId, tenant_id: tenantId, lead_id: leadId, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, queued_at: new Date(Date.now() - 150_000).toISOString() }); if (queue.error) throw new Error(queue.error.message);
  const owner = await cookie(ownerId); const bookkeeper = await cookie(bookkeeperId); const other = await cookie(otherOwnerId, otherTenantId); const expired = await cookie(ownerId, tenantId, true);
  try {
    const emptyTenantId = randomUUID(); const emptyUserId = randomUUID();
    await db.from("tenants").insert({ id: emptyTenantId, name: `LA-1.15 Empty ${stamp}`, status: "active", onboarding_state: "completed" });
    await db.from("users").insert({ id: emptyUserId, email: `la115-empty-${stamp}@invalid.test`, name: "Empty Floor", password_hash: "verification-only", status: "active" });
    await db.from("tenant_users").insert({ tenant_id: emptyTenantId, user_id: emptyUserId, role: "owner" });
    await db.from("tenant_entitlements").insert({ tenant_id: emptyTenantId, entitlement: { tenant_id: emptyTenantId, plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["inbound_transfers"], meters: {}, limits: {} } });
    const emptyCookie = await cookie(emptyUserId, emptyTenantId);
    const empty = await api("/api/app/agent-floor", emptyCookie); const emptyBody = await empty.json();
    check("brand-new tenant renders an empty floor", empty.status === 200 && emptyBody.waiting?.length === 0 && emptyBody.onCalls?.length === 0, `status ${empty.status}`);
    await db.from("tenant_entitlements").delete().eq("tenant_id", emptyTenantId); await db.from("tenant_users").delete().eq("tenant_id", emptyTenantId); await db.from("users").delete().eq("id", emptyUserId); await db.from("tenants").delete().eq("id", emptyTenantId);

    const floor = await api(`/api/app/agent-floor?tenant_id=${otherTenantId}`, owner); const floorBody = await floor.json();
    check("floor is tenant-scoped from session, not request parameters", floor.status === 200 && floorBody.waiting?.some((item) => item.id === queueId) && !JSON.stringify(floorBody).includes(otherTenantId));
    check("wait timer data is queued_at-backed and survives refresh", floorBody.waiting?.[0]?.queuedAt && Date.now() - new Date(floorBody.waiting[0].queuedAt).getTime() >= 120_000);
    check("screening and duplicate fields are present before claim", Object.prototype.hasOwnProperty.call(floorBody.waiting[0], "screeningWarning") && Object.prototype.hasOwnProperty.call(floorBody.waiting[0], "duplicateWarning"));

    const wrongRole = await api("/api/app/agent-floor", bookkeeper); check("wrong tenant role is rejected", wrongRole.status === 403);
    const forged = await api("/api/app/agent-floor", "insurvas_tenant_session=forged"); check("forged session fails closed", forged.status === 401);
    const expiredResponse = await api("/api/app/agent-floor", expired); check("expired session fails closed", expiredResponse.status === 401);
    const crossTenant = await api("/api/app/agent-floor", other); const crossBody = await crossTenant.json(); check("another tenant cannot see this floor", crossTenant.status === 200 && crossBody.waiting?.length === 0);
    const hostile = await api("/api/app/agent-floor", owner, { method: "POST", ...json({ action: "nudge", work_item_id: queueId, message: "x".repeat(241) }) }); check("hostile oversized free text is rejected", hostile.status === 400);

    const key = randomUUID();
    const [nudgeA, nudgeB] = await Promise.all([api("/api/app/agent-floor", owner, { method: "POST", ...json({ action: "nudge", work_item_id: queueId, idempotency_key: key, message: "Please take this call." }) }), api("/api/app/agent-floor", owner, { method: "POST", ...json({ action: "nudge", work_item_id: queueId, idempotency_key: key, message: "Please take this call." }) })]);
    const nudgeBodies = await Promise.all([nudgeA.json(), nudgeB.json()]); const nudgeRows = await db.from("agent_floor_nudges").select("id").eq("tenant_id", tenantId).eq("idempotency_key", key); const nudgeAudits = await db.from("audit_log").select("id").eq("actor_id", ownerId).eq("action", "tenant.agent_floor_nudged").eq("target_id", queueId);
    check("same nudge request is idempotent under concurrency", nudgeA.status === 200 && nudgeB.status === 200 && nudgeBodies.some((body) => body.nudge?.alreadySent === true) && nudgeRows.data?.length === 1 && nudgeAudits.data?.length === 1);
    const presence = await api("/api/app/agent-floor", owner, { method: "POST", ...json({ action: "presence", status: "ready" }) }); check("availability update succeeds and is audited", presence.status === 200 && (await db.from("audit_log").select("id").eq("actor_id", ownerId).eq("action", "tenant.agent_presence_updated")).data?.length === 1);
    await db.from("agent_presence").update({ last_seen_at: new Date(Date.now() - 61_000).toISOString() }).eq("tenant_id", tenantId).eq("user_id", ownerId);
    const staleFloor = await api("/api/app/agent-floor", owner); const staleBody = await staleFloor.json(); check("stale heartbeat is shown offline", staleBody.members?.find((member) => member.id === ownerId)?.availability === "offline");

    let realtimeReceived = false;
    let realtimeReceivedAt = 0;
    let realtimeChannel;
    if (realtime) {
      realtimeChannel = realtime.channel(`agent-floor:${tenantId}`).on("broadcast", { event: "floor_changed" }, (payload) => { if (payload.payload?.tenant_id === tenantId) { realtimeReceived = true; realtimeReceivedAt = Date.now(); } });
      await new Promise((resolve) => { realtimeChannel.subscribe((status) => { if (status === "SUBSCRIBED") resolve(); }); setTimeout(resolve, 5000); });
      const realtimeStartedAt = Date.now();
      await db.from("lead_queue").update({ updated_at: new Date().toISOString() }).eq("id", queueId);
      const deadline = Date.now() + 5000; while (!realtimeReceived && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
      await realtime.removeChannel(realtimeChannel);
      check("database change reaches every open floor in under one second", realtimeReceived && realtimeReceivedAt - realtimeStartedAt < 1000, realtimeReceived ? `${realtimeReceivedAt - realtimeStartedAt}ms` : "no event");
    }
    check("database change emits a tenant-scoped Realtime floor signal", Boolean(realtime) && realtimeReceived);

    const activeCall = await db.from("active_calls").insert({ tenant_id: tenantId, work_item_id: queueId, lead_id: leadId, user_id: ownerId, agent_role: "owner", started_at: new Date(Date.now() - 90_000).toISOString() });
    if (activeCall.error) throw new Error(activeCall.error.message);
    const onCall = await api("/api/app/agent-floor", owner); const onCallBody = await onCall.json(); check("on-call band uses an open active_calls row", onCall.status === 200 && onCallBody.onCalls?.some((item) => item.activeCallId));

    const suspended = await db.from("tenant_entitlements").update({ entitlement: { ...grants.entitlement, status: "suspended", access: "read_only" } }).eq("tenant_id", tenantId); if (suspended.error) throw new Error(suspended.error.message);
    const readOnly = await api("/api/app/agent-floor", owner); const readOnlyBody = await readOnly.json(); const blockedWrite = await api("/api/app/agent-floor", owner, { method: "POST", ...json({ action: "presence", status: "ready" }) }); check("suspended tenant can read its floor but cannot write", readOnly.status === 200 && readOnlyBody.onCalls?.length === 1 && blockedWrite.status === 403, `GET ${readOnly.status} calls ${readOnlyBody.onCalls?.length} write ${blockedWrite.status}`);
  } finally { await cleanup(); if (realtime) { await realtime.removeAllChannels(); realtime.realtime.disconnect(); } }
  console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll LA-1.15 Agent Floor checks passed.");
  return failures ? 1 : 0;
}
const exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
process.exit(exitCode);
