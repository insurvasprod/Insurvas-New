import "./lib/refuseProduction.mjs";
// LA-1.10 live acceptance check. Creates disposable tenant data and drives the real agent routes.
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import { createFixtureUser, deleteFixtureUser, deleteLa1FixtureRowsInBatches, deleteLa1FixtureTenant } from "./lib/fixtureUser.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const realtime = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } }) : null;
const stamp = Date.now();
const tenantId = randomUUID(); let ownerId = null; let producerId = null; let assistantId = null; const otherTenantId = randomUUID(); let otherOwnerId = null;
const createdLeadIds = []; const createdQueueIds = [];
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } };
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function session(userId, currentTenant = tenantId, expired = false) { return `insurvas_tenant_session=${await new SignJWT({ tenantId: currentTenant }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 1 : "10m").sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET))}`; }
async function api(path, cookie, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie, ...(options.headers ?? {}) }, redirect: "manual" }); }
/** A function a pending migration adds is not there yet (PostgREST PGRST202 / Postgres 42883). The probe's random ids make it refuse before it writes. */
async function schemaPending(name, args) { const result = await db.rpc(name, args); return Boolean(result.error && (result.error.code === "PGRST202" || result.error.code === "42883")); }
const skip = (label, reason) => console.log(`  skip ${label} — schema pending: ${reason}`);

async function cleanup() {
  for (const id of [tenantId, otherTenantId]) {
    await db.from("agent_capacity").delete().eq("tenant_id", id);
    const leads = await db.from("agent_leads").select("id").eq("tenant_id", id); const leadIds = (leads.data ?? []).map((row) => row.id);
    if (leadIds.length) {
      await db.from("partner_messages").delete().eq("tenant_id", id);
      await db.from("active_calls").delete().eq("tenant_id", id);
      await db.from("tenant_verification_sessions").delete().eq("tenant_id", id);
      await deleteLa1FixtureRowsInBatches(db, "lead_queue", id);
      await deleteLa1FixtureRowsInBatches(db, "agent_leads", id);
    }
    await db.from("audit_log").delete().in("actor_id", [ownerId, producerId, assistantId, otherOwnerId]);
    await db.from("tenant_entitlements").delete().eq("tenant_id", id);
    await db.from("tenant_users").delete().eq("tenant_id", id);
    await deleteLa1FixtureTenant(db, id);
    for (const id of [ownerId, producerId, assistantId, otherOwnerId]) await deleteFixtureUser(db, id);
  }
}

async function main() {
  if (!process.env.TENANT_SESSION_SECRET) throw new Error("TENANT_SESSION_SECRET is required");
  await cleanup();
  const tenant = await db.from("tenants").insert([{ id: tenantId, name: `LA-1.10 QA ${stamp}`, status: "active", onboarding_state: "completed" }, { id: otherTenantId, name: `LA-1.10 other ${stamp}`, status: "active", onboarding_state: "completed" }]); if (tenant.error) throw new Error(tenant.error.message);
  ({ userId: ownerId } = await createFixtureUser(db, { email: `la110-owner-${stamp}@invalid.test`, name: "LA-1.10 owner" }));
  ({ userId: producerId } = await createFixtureUser(db, { email: `la110-producer-${stamp}@invalid.test`, name: "LA-1.10 producer" }));
  ({ userId: assistantId } = await createFixtureUser(db, { email: `la110-assistant-${stamp}@invalid.test`, name: "LA-1.10 assistant" }));
  ({ userId: otherOwnerId } = await createFixtureUser(db, { email: `la110-other-${stamp}@invalid.test`, name: "LA-1.10 other" }));
  const members = await db.from("tenant_users").insert([{ tenant_id: tenantId, user_id: ownerId, role: "owner" }, { tenant_id: tenantId, user_id: producerId, role: "producer" }, { tenant_id: tenantId, user_id: assistantId, role: "assistant" }, { tenant_id: otherTenantId, user_id: otherOwnerId, role: "owner" }]); if (members.error) throw new Error(members.error.message);
  const entitlements = await db.from("tenant_entitlements").insert([{ tenant_id: tenantId, entitlement: { tenant_id: tenantId, plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["inbound_transfers"], meters: {}, limits: {} } }, { tenant_id: otherTenantId, entitlement: { tenant_id: otherTenantId, plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["inbound_transfers"], meters: {}, limits: {} } }]); if (entitlements.error) throw new Error(entitlements.error.message);
  const pipeline = await db.from("tenant_pipelines").select("id").eq("tenant_id", tenantId).eq("partner_type", "publisher").eq("is_default", true).single(); const stage = pipeline.data ? await db.from("tenant_pipeline_stages").select("id").eq("pipeline_id", pipeline.data.id).eq("is_archived", false).order("position").limit(1).single() : { data: null, error: new Error("no pipeline") }; const template = await db.from("templates").select("id").eq("product_code", "term_life").eq("is_active", true).limit(1).single(); if (pipeline.error || stage.error || template.error) throw new Error(pipeline.error?.message ?? stage.error?.message ?? template.error?.message ?? "Fixture dependency missing");
  const leadRows = Array.from({ length: 3 }, (_, index) => ({ id: randomUUID(), tenant_id: tenantId, template_id: template.data.id, template_version: 1, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, values: { full_name: `Inbox Prospect ${index + 1}`, age: 60 + index, state: index === 1 ? "NM" : "AZ" }, created_by: ownerId, submission_id: randomUUID() }));
  const leads = await db.from("agent_leads").insert(leadRows).select("id"); if (leads.error) throw new Error(leads.error.message); createdLeadIds.push(...(leads.data ?? []).map((row) => row.id));
  const partner = await db.from("partners").insert({ slug: `fx-${Math.random().toString(36).slice(2, 10)}`, tenant_id: tenantId, name: `LA-1.10 Partner ${stamp}`, partner_type: "publisher", status: "active", timezone: "America/Phoenix" }).select("id").single(); if (partner.error) throw new Error(partner.error.message);
  const queues = await db.from("lead_queue").insert(createdLeadIds.map((leadId, index) => ({ id: randomUUID(), tenant_id: tenantId, lead_id: leadId, partner_id: index === 2 ? null : partner.data.id, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, queued_at: new Date(Date.now() - (3 - index) * 60_000).toISOString() }))).select("id, lead_id"); if (queues.error) throw new Error(queues.error.message); createdQueueIds.push(...(queues.data ?? []).map((row) => row.id));
  // 20260924170000: the inbox reads only rows with a partner and keeps the NEWEST 500. Two named rows
  // have a partner (the third is the no-partner dialer-style row), so 498 more makes exactly 500 inbound
  // transfers: the cap is reached but nothing is cut, and the oldest named row must lead the list.
  const bulkLeadRows = Array.from({ length: 498 }, (_, index) => ({ id: randomUUID(), tenant_id: tenantId, template_id: template.data.id, template_version: 1, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, values: { full_name: `Bulk Inbox Prospect ${index + 1}`, age: 70, state: "AZ" }, created_by: ownerId, submission_id: randomUUID() }));
  const bulkLeads = await db.from("agent_leads").insert(bulkLeadRows).select("id"); if (bulkLeads.error) throw new Error(bulkLeads.error.message); createdLeadIds.push(...(bulkLeads.data ?? []).map((row) => row.id));
  const bulkQueues = await db.from("lead_queue").insert((bulkLeads.data ?? []).map((row) => ({ id: randomUUID(), tenant_id: tenantId, lead_id: row.id, partner_id: partner.data.id, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id }))).select("id"); if (bulkQueues.error) throw new Error(bulkQueues.error.message); createdQueueIds.push(...(bulkQueues.data ?? []).map((row) => row.id));
  const owner = await session(ownerId); const producer = await session(producerId); const assistant = await session(assistantId); const otherOwner = await session(otherOwnerId, otherTenantId); const expiredOwner = await session(ownerId, tenantId, true);
  try {
    await api("/api/app/inbound", owner); const inboxStart = Date.now(); const inbox = await api("/api/app/inbound", owner); const inboxBody = await inbox.json(); const inboxDuration = Date.now() - inboxStart; check("inbox returns oldest-first transfer rows and filter options", inbox.status === 200 && inboxBody.items?.length === 500 && inboxBody.truncated !== true && !inboxBody.items.some((item) => item.id === createdQueueIds[2]) && inboxBody.items[0].customer === "Inbox Prospect 1" && inboxBody.items[0].partnerName.includes("LA-1.10 Partner"), `status ${inbox.status}, body ${JSON.stringify(inboxBody).slice(0, 400)}`); check("inbox loads 500 unclaimed transfers in under one second", inbox.status === 200 && inboxDuration < 1000, `${inboxDuration}ms`); console.log(`  info inbox latency: ${inboxDuration}ms`);
    const filtered = await api("/api/app/inbound?state=NM&screening_outcome=not_checked", owner); const filteredBody = await filtered.json(); check("partner, product, state and screening filters are server-applied", filtered.status === 200 && filteredBody.items?.length === 1 && filteredBody.items[0].state === "NM");
    let inboxRealtimeReceived = false; let inboxRealtimeReceivedAt = 0; let inboxRealtimeStatus = "not_started"; let inboxRealtimeChannel;
    if (realtime) {
      inboxRealtimeChannel = realtime.channel(`agent-floor:${tenantId}`).on("broadcast", { event: "floor_changed" }, (payload) => { if (payload.payload?.tenant_id === tenantId) { inboxRealtimeReceived = true; inboxRealtimeReceivedAt = Date.now(); } });
      await new Promise((resolve) => { inboxRealtimeChannel.subscribe((channelStatus) => { inboxRealtimeStatus = channelStatus; if (channelStatus === "SUBSCRIBED") resolve(); else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(channelStatus)) resolve(); }); setTimeout(resolve, 5000); });
    }
    const claimStartedAt = Date.now();
    const races = await Promise.all([api("/api/app/inbound/claim", owner, { method: "POST", ...json({ work_item_id: createdQueueIds[0] }) }), api("/api/app/inbound/claim", producer, { method: "POST", ...json({ work_item_id: createdQueueIds[0] }) })]); const raceBodies = await Promise.all(races.map((response) => response.json())); const winnerCount = races.filter((response) => response.status === 200).length; const loser = raceBodies.find((body, index) => races[index].status === 409); const stored = await db.from("lead_queue").select("status, owner_user_id, claimed_by").eq("id", createdQueueIds[0]).single(); const callCount = await db.from("active_calls").select("id", { count: "exact", head: true }).eq("work_item_id", createdQueueIds[0]).is("ended_at", null); check("two simultaneous claims produce one winner, one clear conflict and one active call", winnerCount === 1 && races.some((response) => response.status === 409) && loser?.error?.includes("already claimed") && stored.data?.status === "claimed" && stored.data.owner_user_id === stored.data.claimed_by && callCount.count === 1, `statuses ${races.map((response) => response.status).join(",")}`);
    if (inboxRealtimeChannel) {
      const deadline = Date.now() + 5000; while (!inboxRealtimeReceived && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
      await realtime.removeChannel(inboxRealtimeChannel);
    }
    check("claim broadcasts the tenant-scoped inbox invalidation within one second", Boolean(realtime) && inboxRealtimeReceived && inboxRealtimeReceivedAt - claimStartedAt < 1000, inboxRealtimeReceived ? `${inboxRealtimeReceivedAt - claimStartedAt}ms (${inboxRealtimeStatus})` : `no event (${inboxRealtimeStatus})`);
    const afterClaim = await api("/api/app/inbound", producer); const afterBody = await afterClaim.json(); check("claimed lead disappears from the default inbox after refresh", afterClaim.status === 200 && !afterBody.items?.some((item) => item.id === createdQueueIds[0]));
    const chatFailure = await api("/api/app/inbound/claim", owner, { method: "POST", ...json({ work_item_id: createdQueueIds[2] }) }); const chatBody = await chatFailure.json(); const chatCall = await db.from("active_calls").select("id").eq("work_item_id", createdQueueIds[2]).is("ended_at", null).maybeSingle(); check("partner chat failure does not roll back a successful claim", chatFailure.status === 200 && chatBody.chatPosted === false && chatBody.claim?.active_call_id === chatCall.data?.id);
    await db.from("lead_queue").update({ status: "unclaimed", owner_user_id: null, claimed_by: null, owner_role: null, claimed_at: null }).eq("id", createdQueueIds[1]); await db.from("active_calls").insert({ tenant_id: tenantId, work_item_id: createdQueueIds[1], lead_id: createdLeadIds[1], user_id: ownerId, agent_role: "owner", started_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() }); const reclaimed = await api("/api/app/inbound/claim", owner, { method: "POST", ...json({ work_item_id: createdQueueIds[1] }) }); const reclaimedBody = await reclaimed.json(); const openCalls = await db.from("active_calls").select("id, ended_at", { count: "exact" }).eq("work_item_id", createdQueueIds[1]); check("re-claim closes a stale dropped call and opens a fresh active call", reclaimed.status === 200 && openCalls.count === 2 && openCalls.data?.filter((call) => call.ended_at === null).length === 1 && reclaimedBody.claim?.active_call_id);
    const crossTenant = await api("/api/app/inbound", otherOwner); const crossBody = await crossTenant.json(); check("tenant scope prevents another tenant from seeing this inbox", crossTenant.status === 200 && crossBody.items?.length === 0);
    const assistantAccess = await api("/api/app/inbound", assistant); const assistantClaim = await api("/api/app/inbound/claim", assistant, { method: "POST", ...json({ work_item_id: createdQueueIds[1] }) }); check("assistant role can use the buffer inbox but cannot steal an already claimed transfer", assistantAccess.status === 200 && assistantClaim.status === 409);
    const forged = await api("/api/app/inbound", "insurvas_tenant_session=forged"); check("forged session fails closed", forged.status === 401);
    const expired = await api("/api/app/inbound", expiredOwner); check("expired session fails closed", expired.status === 401);
    const hostile = await api("/api/app/inbound?product_line=%3Cscript%3Ealert(1)%3C%2Fscript%3E", owner); check("hostile filter input is rejected", hostile.status === 400);
    // ── 20260925709850 / 709860: age, giving a transfer back, resuming it, and language ──────────────
    // Created only now, so the 500-row checks above are untouched.
    const extraLeads = [
      { id: randomUUID(), values: { full_name: "Birthday Prospect", date_of_birth: "1960-04-02", state: "AZ" } },
      { id: randomUUID(), values: { full_name: "Requeue Prospect", age: 66, state: "AZ" } },
      { id: randomUUID(), values: { full_name: "Spanish Prospect", age: 70, state: "TX", language: "Spanish" } },
    ];
    const extraInsert = await db.from("agent_leads").insert(extraLeads.map((lead) => ({ id: lead.id, tenant_id: tenantId, template_id: template.data.id, template_version: 1, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, values: lead.values, created_by: ownerId, submission_id: randomUUID() }))); if (extraInsert.error) throw new Error(extraInsert.error.message);
    const extraQueue = await db.from("lead_queue").insert(extraLeads.map((lead) => ({ id: randomUUID(), tenant_id: tenantId, lead_id: lead.id, partner_id: partner.data.id, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id }))).select("id, lead_id"); if (extraQueue.error) throw new Error(extraQueue.error.message);
    const [birthdayItem, requeueItem, spanishItem] = extraLeads.map((lead) => extraQueue.data.find((row) => row.lead_id === lead.id).id);
    if (await schemaPending("lead_values_age", { p_values: {} })) skip("inbox age from a date of birth (LA-1.10-2)", "20260925709850 is not applied");
    else {
      const today = new Date(); const years = today.getFullYear() - 1960 - (today.getMonth() < 3 || (today.getMonth() === 3 && today.getDate() < 2) ? 1 : 0);
      const aged = await api("/api/app/inbound?status=all", owner); const agedBody = await aged.json(); const row = agedBody.items?.find((item) => item.id === birthdayItem);
      check("the inbox works out age from the date of birth when the form recorded none (LA-1.10-2)", aged.status === 200 && row?.age === String(years), JSON.stringify({ status: aged.status, age: row?.age, expected: years }));
    }
    if (await schemaPending("return_transfer_to_queue", { p_tenant_id: randomUUID(), p_work_item_id: randomUUID(), p_actor: randomUUID(), p_reason: "unassign" })) {
      skip("unassign, requeue, resumed verification and language refusal (LA-1.10-8, LA-1.11-6, LA-1.14-10)", "20260925709860 is not applied");
    } else {
      const first = await api("/api/app/inbound/claim", owner, { method: "POST", ...json({ work_item_id: requeueItem }) }); const firstBody = await first.json(); const sessionId = firstBody.claim?.verification_session_id;
      check("a first claim is not a resumed one", first.status === 200 && firstBody.resumed === false && Boolean(sessionId), JSON.stringify(firstBody).slice(0, 300));
      const unassign = await api("/api/app/inbound/release", owner, { method: "POST", ...json({ action: "unassign", work_item_id: requeueItem }) });
      const afterUnassign = await db.from("lead_queue").select("status, owner_user_id, requeue_count, requeued_at").eq("id", requeueItem).single();
      const closedSession = await db.from("tenant_verification_sessions").select("status, ended_at").eq("id", sessionId).single();
      check("unassign gives the transfer back: nobody owns it and its session is closed, not deleted", unassign.status === 200 && afterUnassign.data?.status === "unclaimed" && afterUnassign.data.owner_user_id === null && afterUnassign.data.requeue_count === 1 && Boolean(afterUnassign.data.requeued_at) && closedSession.data?.status === "closed", JSON.stringify({ status: unassign.status, queue: afterUnassign.data, session: closedSession.data }));
      const reclaim = await api("/api/app/inbound/claim", producer, { method: "POST", ...json({ work_item_id: requeueItem }) }); const reclaimBody = await reclaim.json();
      check("the re-claim resumes the same verification session and says so (LA-1.11-6)", reclaim.status === 200 && reclaimBody.resumed === true && reclaimBody.claim?.verification_session_id === sessionId, JSON.stringify(reclaimBody).slice(0, 300));
      // The call drops: what complete_disposition leaves behind for a 'dropped' outcome.
      await db.from("lead_queue").update({ status: "dropped", disposition: "dropped", disposition_at: new Date().toISOString(), disposition_by: producerId }).eq("id", requeueItem);
      await db.from("tenant_verification_sessions").update({ status: "closed", ended_at: new Date().toISOString(), completed_at: new Date().toISOString() }).eq("id", sessionId);
      await db.from("active_calls").update({ ended_at: new Date().toISOString() }).eq("work_item_id", requeueItem).is("ended_at", null);
      const wrongActor = await api("/api/app/inbound/release", producer, { method: "POST", ...json({ action: "unassign", work_item_id: requeueItem }) });
      const requeued = await api("/api/app/inbound/release", producer, { method: "POST", ...json({ action: "requeue", work_item_id: requeueItem }) });
      const afterRequeue = await db.from("lead_queue").select("status, requeue_count, queued_at, sla_escalated_at").eq("id", requeueItem).single();
      check("a dropped call goes back in the queue, waiting again from now (LA-1.10-8)", wrongActor.status === 409 && requeued.status === 200 && afterRequeue.data?.status === "unclaimed" && afterRequeue.data.requeue_count === 2 && Date.now() - new Date(afterRequeue.data.queued_at).getTime() < 60_000 && afterRequeue.data.sla_escalated_at === null, JSON.stringify({ wrongActor: wrongActor.status, requeued: requeued.status, queue: afterRequeue.data }));
      const resumed = await api("/api/app/inbound/claim", owner, { method: "POST", ...json({ work_item_id: requeueItem }) }); const resumedBody = await resumed.json();
      const cards = await db.from("partner_messages").select("event_key").eq("work_item_id", requeueItem);
      const cardKeys = new Set((cards.data ?? []).map((row) => row.event_key));
      check("after the requeue the claim resumes the session again, and the partner gets a card per claim (LA-1.14-7)", resumed.status === 200 && resumedBody.resumed === true && resumedBody.claim?.verification_session_id === sessionId && cardKeys.has(`claim:${requeueItem}`) && cardKeys.has(`claim:${requeueItem}:requeue-1`) && cardKeys.has(`claim:${requeueItem}:requeue-2`), JSON.stringify({ body: resumedBody, cards: [...cardKeys] }).slice(0, 500));
      const refused = await api("/api/app/inbound/claim", producer, { method: "POST", ...json({ work_item_id: spanishItem }) }); const refusedBody = await refused.json();
      const refusedNext = await api("/api/app/inbound/claim-next", producer, { method: "POST", ...json({ state: "TX" }) }); const refusedNextBody = await refusedNext.json();
      const stillWaiting = await db.from("lead_queue").select("status").eq("id", spanishItem).single();
      check("a caller who asked for Spanish is refused, clearly, to an agent who does not list it (LA-1.14-10)", refused.status === 409 && refusedBody.code === "language_not_spoken" && /Spanish/.test(refusedBody.error ?? "") && refusedNext.status === 409 && refusedNextBody.code === "LANGUAGE_NOT_SPOKEN" && stillWaiting.data?.status === "unclaimed", JSON.stringify({ refused: refusedBody, next: refusedNextBody, queue: stillWaiting.data }).slice(0, 500));
      await db.from("agent_capacity").upsert({ tenant_id: tenantId, user_id: producerId, languages: ["es"] }, { onConflict: "tenant_id,user_id" });
      const spoken = await api("/api/app/inbound/claim-next", producer, { method: "POST", ...json({ state: "TX" }) }); const spokenBody = await spoken.json();
      check("once the agent lists it (as 'es'), claim next hands them that caller", spoken.status === 200 && spokenBody.claim?.work_item_id === spanishItem, JSON.stringify(spokenBody).slice(0, 300));
    }
    const audits = await db.from("audit_log").select("action").eq("actor_id", ownerId).in("action", ["tenant.transfer_claimed", "tenant.transfer_claim_chat_failed"]); check("claim and best-effort chat failure leave audit evidence", (audits.data ?? []).length >= 3);
  } finally { await cleanup(); }
  console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll LA-1.10 transfer inbox checks passed."); return failures ? 1 : 0;
}
process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
