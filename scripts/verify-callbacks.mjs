// LA-1.22 live contract and failure-path verification. All rows are disposable and cleaned up.
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import { createFixtureUser, deleteFixtureUser } from "./lib/fixtureUser.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now(); const tenantId = randomUUID(); const otherTenantId = randomUUID(); let ownerId = null; let bookkeeperId = null; let otherOwnerId = null; const leadId = randomUUID(); const queueId = randomUUID(); const callbackId = randomUUID(); const overdueCallbackId = randomUUID();
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } };
async function cookie(userId, tenant = tenantId, expired = false) { return `insurvas_tenant_session=${await new SignJWT({ tenantId: tenant }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 1 : "10m").sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET))}`; }
async function api(path, session, init = {}) { return fetch(`${BASE}${path}`, { ...init, headers: { cookie: session, ...(init.headers ?? {}) }, redirect: "manual" }); }
async function cleanup() {
  await db.from("tenant_callbacks").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("callback_history").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("lead_queue").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("agent_leads").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("tenant_entitlements").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("tenant_users").delete().in("tenant_id", [tenantId, otherTenantId]);
  for (const id of [ownerId, bookkeeperId, otherOwnerId]) await deleteFixtureUser(db, id);
  await db.from("tenants").delete().in("id", [tenantId, otherTenantId]);
}
async function main() {
  if (!process.env.TENANT_SESSION_SECRET) throw new Error("TENANT_SESSION_SECRET is required");
  await cleanup();
  const tenants = await db.from("tenants").insert([{ id: tenantId, name: `LA-1.22 QA ${stamp}`, status: "active", onboarding_state: "completed" }, { id: otherTenantId, name: `LA-1.22 Other ${stamp}`, status: "active", onboarding_state: "completed" }]);
  if (tenants.error) throw new Error(tenants.error.message);
  ({ userId: ownerId } = await createFixtureUser(db, { email: `la122-owner-${stamp}@invalid.test`, name: "Callback Owner" }));
  ({ userId: bookkeeperId } = await createFixtureUser(db, { email: `la122-bookkeeper-${stamp}@invalid.test`, name: "Callback Bookkeeper" }));
  ({ userId: otherOwnerId } = await createFixtureUser(db, { email: `la122-other-${stamp}@invalid.test`, name: "Other Owner" }));
  const acceptedAt = new Date().toISOString();
  const members = await db.from("tenant_users").insert([{ tenant_id: tenantId, user_id: ownerId, role: "owner", accepted_at: acceptedAt }, { tenant_id: tenantId, user_id: bookkeeperId, role: "bookkeeper", accepted_at: acceptedAt }, { tenant_id: otherTenantId, user_id: otherOwnerId, role: "owner", accepted_at: acceptedAt }]);
  if (members.error) throw new Error(members.error.message);
  const entitlement = (id) => ({ tenant_id: id, entitlement: { tenant_id: id, plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["callback_calendar", "inbound_transfers"], meters: {}, limits: {} } });
  const grants = await db.from("tenant_entitlements").insert([entitlement(tenantId), entitlement(otherTenantId)]); if (grants.error) throw new Error(grants.error.message);
  const pipeline = await db.from("tenant_pipelines").select("id").eq("tenant_id", tenantId).eq("is_default", true).limit(1).maybeSingle();
  const stage = pipeline.data ? await db.from("tenant_pipeline_stages").select("id").eq("pipeline_id", pipeline.data.id).eq("is_archived", false).order("position").limit(1).maybeSingle() : { data: null, error: null };
  const template = await db.from("templates").select("id").eq("is_active", true).limit(1).maybeSingle();
  if (pipeline.error || stage.error || template.error || !pipeline.data || !stage.data || !template.data) throw new Error("Pipeline, stage, or template dependency is missing");
  const lead = await db.from("agent_leads").insert({ id: leadId, tenant_id: tenantId, template_id: template.data.id, template_version: 1, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, values: { full_name: "Callback Prospect", state: "AZ" }, created_by: ownerId, submission_id: randomUUID() }); if (lead.error) throw new Error(lead.error.message);
  const queue = await db.from("lead_queue").insert({ id: queueId, tenant_id: tenantId, lead_id: leadId, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, status: "completed", owner_user_id: ownerId, owner_role: "owner", queued_at: new Date().toISOString() }); if (queue.error) throw new Error(queue.error.message);
  const scheduled = "2027-01-02T22:00:00.000Z";
  const callback = await db.from("tenant_callbacks").insert({ id: callbackId, tenant_id: tenantId, lead_id: leadId, work_item_id: queueId, scheduled_at_utc: scheduled, customer_timezone: "America/Phoenix", assigned_to: ownerId, created_by: ownerId, note: "Call about coverage", reminder_sent_at: new Date().toISOString(), idempotency_key: randomUUID() }); if (callback.error) throw new Error(callback.error.message);
  const overdue = await db.from("tenant_callbacks").insert({ id: overdueCallbackId, tenant_id: tenantId, lead_id: leadId, work_item_id: queueId, scheduled_at_utc: "2020-01-02T22:00:00.000Z", customer_timezone: "America/Phoenix", assigned_to: ownerId, created_by: ownerId, note: "Older follow-up", status: "missed", idempotency_key: randomUUID() }); if (overdue.error) throw new Error(overdue.error.message);
  const invalidAssignee = await db.from("tenant_callbacks").insert({ id: randomUUID(), tenant_id: tenantId, lead_id: leadId, work_item_id: queueId, scheduled_at_utc: scheduled, customer_timezone: "America/Phoenix", assigned_to: bookkeeperId, created_by: ownerId, note: "Must be rejected", idempotency_key: randomUUID() }); check("non-agent callback assignees are rejected by the database", invalidAssignee.error?.message?.includes("CALLBACK_ASSIGNEE_ROLE_INVALID"));
  const owner = await cookie(ownerId); const bookkeeper = await cookie(bookkeeperId); const other = await cookie(otherOwnerId, otherTenantId); const expired = await cookie(ownerId, tenantId, true);
  try {
    const zone = await db.rpc("reschedule_callback", { p_tenant_id: tenantId, p_callback_id: callbackId, p_actor: ownerId, p_callback_local: "2027-01-03T14:00" });
    check("customer-local callback time is converted and stored as UTC", !zone.error && zone.data?.customer_timezone === "America/Phoenix" && zone.data?.scheduled_at_utc === "2027-01-03T21:00:00+00:00", zone.error?.message ?? JSON.stringify(zone.data));
    const resetReminder = await db.from("tenant_callbacks").select("reminder_sent_at").eq("id", callbackId).single(); check("rescheduling resets the reminder marker", !resetReminder.error && resetReminder.data?.reminder_sent_at === null);

    // Criterion 4 is "rescheduling moves the reminder AND leaves a timeline entry". The reminder half
    // is above; the timeline half was untested. callback_history is what the lead workspace renders,
    // so a reschedule that moved the time without recording it would be a silent edit of history --
    // the customer's callback moves and nothing says who moved it or from when.
    const rescheduleHistory = await db.from("callback_history").select("action, old_scheduled_at_utc, new_scheduled_at_utc, actor_user_id").eq("callback_id", callbackId).eq("action", "rescheduled").maybeSingle();
    check("rescheduling leaves a timeline entry naming the old and new time", !rescheduleHistory.error && rescheduleHistory.data?.actor_user_id === ownerId && Boolean(rescheduleHistory.data?.old_scheduled_at_utc) && rescheduleHistory.data?.new_scheduled_at_utc?.startsWith("2027-01-03T21:00"), JSON.stringify(rescheduleHistory.data ?? rescheduleHistory.error?.message));

    // Criterion 1 says the conversion is "verified across a zone boundary". America/Phoenix is the
    // right first case precisely because it never observes DST -- but on its own it cannot tell a
    // real timezone conversion from a stored fixed offset, because Phoenix is UTC-7 all year. So
    // convert the same wall-clock time in a zone that does observe DST, in both halves of the year:
    // 2pm in New York is 19:00 UTC in January and 18:00 UTC in July. A fixed-offset implementation
    // gets exactly one of those wrong, which is the bug the task's timezone rule exists to prevent.
    //
    // This reuses the existing callback rather than adding one: tenant_callbacks carries a unique
    // index on (tenant_id, work_item_id) for active statuses, so a second scheduled callback on the
    // same work item is correctly refused.
    await db.from("tenant_callbacks").update({ customer_timezone: "America/New_York" }).eq("id", callbackId);
    const dstWinter = await db.rpc("reschedule_callback", { p_tenant_id: tenantId, p_callback_id: callbackId, p_actor: ownerId, p_callback_local: "2027-01-06T14:00" });
    const dstSummer = await db.rpc("reschedule_callback", { p_tenant_id: tenantId, p_callback_id: callbackId, p_actor: ownerId, p_callback_local: "2027-07-07T14:00" });
    check("the same wall-clock time converts differently across a DST boundary", !dstWinter.error && !dstSummer.error && dstWinter.data?.scheduled_at_utc?.startsWith("2027-01-06T19:00") && dstSummer.data?.scheduled_at_utc?.startsWith("2027-07-07T18:00"), JSON.stringify({ winter: dstWinter.data?.scheduled_at_utc ?? dstWinter.error?.message, summer: dstSummer.data?.scheduled_at_utc ?? dstSummer.error?.message }));
    // Put the fixture back exactly as the checks below expect to find it.
    await db.from("tenant_callbacks").update({ customer_timezone: "America/Phoenix" }).eq("id", callbackId);
    const restored = await db.rpc("reschedule_callback", { p_tenant_id: tenantId, p_callback_id: callbackId, p_actor: ownerId, p_callback_local: "2027-01-03T14:00" });
    if (restored.error) throw new Error(`could not restore the callback fixture: ${restored.error.message}`);
    const listed = await api("/api/app/callbacks", owner); const listedBody = await listed.json(); check("due callback API is tenant-scoped and returns customer/agent display fields", listed.status === 200 && listedBody.callbacks?.[0]?.customerTimezone === "America/Phoenix" && listedBody.callbacks?.[0]?.customerTime, `status ${listed.status}`);
    check("overdue callbacks remain visible and separately counted", listed.status === 200 && listedBody.callbacks?.some((item) => item.id === overdueCallbackId && item.isOverdue === true));

    // Criterion 2 is "a due callback appears on the Agent Floor AND in the due-today list" -- two
    // surfaces, one of them untested. lib/agentFloor/service.ts calls listDueCallbacks, so the Floor
    // is fed by the same function; that is a reason to expect it to work, not evidence that it does.
    //
    // The overdue callback is the one that belongs here. listDueCallbacks filters to
    // isDueToday || isOverdue, and the other fixture callback is scheduled for 2027 -- so asserting
    // its absence is half the criterion too: the Floor shows a callback WHEN DUE, not every callback
    // that exists. A Floor that listed all of them would pass a "contains" check and be useless.
    const floor = await api("/api/app/agent-floor", owner); const floorBody = await floor.json();
    const onFloor = (floorBody.callbacks ?? []).map((item) => item.id);
    check("a due callback appears on the Agent Floor, and a future one does not", floor.status === 200 && onFloor.includes(overdueCallbackId) && !onFloor.includes(callbackId), JSON.stringify({ status: floor.status, onFloor: onFloor.length, hasOverdue: onFloor.includes(overdueCallbackId), hasFuture: onFloor.includes(callbackId) }));
    const cross = await api(`/api/app/callbacks?tenant_id=${otherTenantId}`, owner); const crossBody = await cross.json(); check("request tenant parameters cannot cross the session tenant", cross.status === 200 && crossBody.callbacks?.every((item) => item.customerTimezone === "America/Phoenix"));
    check("wrong tenant role is rejected", (await api("/api/app/callbacks", bookkeeper)).status === 403);
    check("forged session is rejected", (await api("/api/app/callbacks", "insurvas_tenant_session=forged")).status === 401);
    check("expired session is rejected", (await api("/api/app/callbacks", expired)).status === 401);
    const otherResponse = await api("/api/app/callbacks", other); const otherBody = await otherResponse.json(); check("other tenant cannot read this callback", otherResponse.status === 200 && otherBody.callbacks?.length === 0);
    const missingDate = await api("/api/app/callbacks", owner, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reschedule", callback_id: callbackId }) }); check("reschedule without a date is blocked with a client error", missingDate.status === 400);
    const missingSchedule = await api("/api/app/inbound/disposition", owner, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "complete", work_item_id: queueId, walk_id: randomUUID(), disposition_key: "callback_scheduled" }) }); check("choosing callback scheduled without a date is blocked", missingSchedule.status === 400);
    const hostileNote = await api("/api/app/inbound/disposition", owner, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "complete", work_item_id: queueId, walk_id: randomUUID(), disposition_key: "callback_scheduled", callback_local: "2027-01-03T14:00", callback_note: "<script>alert(1)</script>" }) }); check("hostile callback notes are rejected", hostileNote.status === 400);
    const missingCallback = await api("/api/app/callbacks", owner, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "complete", callback_id: randomUUID() }) }); check("missing callback dependency returns not found", missingCallback.status === 404);
    const concurrent = await Promise.all([db.rpc("complete_callback", { p_tenant_id: tenantId, p_callback_id: callbackId, p_actor: ownerId }), db.rpc("complete_callback", { p_tenant_id: tenantId, p_callback_id: callbackId, p_actor: ownerId })]); check("concurrent completion requests are race-safe", concurrent.every((result) => !result.error) && concurrent.some((result) => result.data?.duplicate === true));
    const completed = concurrent.find((result) => result.data?.reopened === true) ?? concurrent[0]; check("completion reopens the lead queue", !completed.error && completed.data?.reopened === true);
    const queueAfter = await db.from("lead_queue").select("status, owner_user_id, disposition").eq("id", queueId).single(); const history = await db.from("callback_history").select("action").eq("callback_id", callbackId).order("created_at"); check("completion leaves a fresh workable queue and immutable history", queueAfter.data?.status === "unclaimed" && queueAfter.data?.owner_user_id === null && history.data?.some((row) => row.action === "rescheduled") && history.data?.some((row) => row.action === "completed"));
    const duplicate = await db.rpc("complete_callback", { p_tenant_id: tenantId, p_callback_id: callbackId, p_actor: ownerId }); check("same completion request is idempotent", !duplicate.error && duplicate.data?.duplicate === true);
  } finally { await cleanup(); }
  console.log(failures ? `\n${failures} callback check(s) FAILED.` : "\nAll LA-1.22 callback checks passed."); return failures ? 1 : 0;
}
const code = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; }); process.exit(code);
