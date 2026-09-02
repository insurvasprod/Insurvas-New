import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { createClient } from "@supabase\u002fsupabase-js";

const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const secret = new TextEncoder().encode(process.env.TENANT_SESSION_SECRET);

async function sessionCookie(userId, tenantId) {
  const token = await new SignJWT({ tenantId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("12h").sign(secret);
  return `insurvas_tenant_session=${token}`;
}

async function pickAgent() {
  const memberships = await supabase.from("tenant_users").select("tenant_id, user_id, role").in("role", ["owner", "producer", "assistant", "bookkeeper"]).not("accepted_at", "is", null).limit(25);
  assert.equal(memberships.error, null, memberships.error?.message);
  for (const membership of memberships.data ?? []) {
    const user = await supabase.from("users").select("status").eq("id", membership.user_id).maybeSingle();
    if (user.data?.status === "active") return membership;
  }
  throw new Error("No active tenant agent is available for alert verification");
}

async function call(path, cookie, options = {}) {
  return fetch(`${baseUrl}${path}`, { ...options, headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers ?? {}), cookie } });
}

const agent = await pickAgent();
const cookie = await sessionCookie(agent.user_id, agent.tenant_id);
const unauthenticated = await call("/api/app/notifications", "");
assert.equal(unauthenticated.status, 401, "missing session must be rejected");
const forged = await call("/api/app/notifications", "insurvas_tenant_session=not-a-token");
assert.equal(forged.status, 401, "forged session must be rejected");
const wrongPlane = await call("/api/app/notifications", "insurvas_admin_session=not-an-agent-session");
assert.equal(wrongPlane.status, 401, "an admin-plane cookie must not authenticate the agent endpoint");

const initial = await call("/api/app/notifications", cookie);
const initialBody = await initial.json();
assert.equal(initial.status, 200, JSON.stringify(initialBody));
const original = initialBody.settings;
const changed = { ...original, enabled_events: { ...original.enabled_events, partner_message: false }, sound_volume: 42 };
const saved = await call("/api/app/notifications", cookie, { method: "PATCH", body: JSON.stringify(changed) });
const savedBody = await saved.json();
assert.equal(saved.status, 200, JSON.stringify(savedBody));
assert.deepEqual(savedBody.settings, changed, "settings persist through the API");
const reread = await call("/api/app/notifications", cookie);
assert.equal((await reread.json()).settings.sound_volume, 42);

for (const event of Object.keys(original.enabled_events)) {
  const eventSettings = { ...original, enabled_events: { ...original.enabled_events, [event]: false } };
  const eventSave = await call("/api/app/notifications", cookie, { method: "PATCH", body: JSON.stringify(eventSettings) });
  assert.equal(eventSave.status, 200, `event setting ${event} must save`);
  const eventRead = await call("/api/app/notifications", cookie);
  assert.equal((await eventRead.json()).settings.enabled_events[event], false, `event setting ${event} must persist`);
}

const hostile = await call("/api/app/notifications", cookie, { method: "PATCH", body: JSON.stringify({ ...changed, sound_volume: 999, unexpected: "<script>" }) });
assert.equal(hostile.status, 400, "hostile/out-of-range settings must be rejected");

const concurrent = await Promise.all(Array.from({ length: 10 }, (_, index) => call("/api/app/notifications", cookie, { method: "PATCH", body: JSON.stringify({ ...changed, sound_volume: index }) })));
assert.ok(concurrent.every((response) => response.status === 200), "concurrent settings writes must remain valid");
const restored = await call("/api/app/notifications", cookie, { method: "PATCH", body: JSON.stringify(original) });
assert.equal(restored.status, 200);

const sourceKey = `verify-agent-alerts:${crypto.randomUUID()}`;
const row = { tenant_id: agent.tenant_id, recipient_user_id: agent.user_id, kind: "partner_message", title: "Verification alert", body: "Synthetic verification", link: "/app/partner-chat", source_key: sourceKey };
const firstInsert = await supabase.from("agent_notifications").upsert(row, { onConflict: "tenant_id,recipient_user_id,source_key" }).select("id").single();
const secondInsert = await supabase.from("agent_notifications").upsert(row, { onConflict: "tenant_id,recipient_user_id,source_key", ignoreDuplicates: true }).select("id").maybeSingle();
assert.equal(firstInsert.error, null, firstInsert.error?.message);
assert.equal(secondInsert.error, null, secondInsert.error?.message);
const count = await supabase.from("agent_notifications").select("id", { count: "exact", head: true }).eq("tenant_id", agent.tenant_id).eq("recipient_user_id", agent.user_id).eq("source_key", sourceKey);
assert.equal(count.count, 1, "duplicate source keys must create one alert");
await supabase.from("agent_notifications").delete().eq("tenant_id", agent.tenant_id).eq("recipient_user_id", agent.user_id).eq("source_key", sourceKey);

const schema = await supabase.from("agent_notification_settings").select("tenant_id, user_id, enabled_events, do_not_disturb, sound_muted, sound_volume").eq("tenant_id", agent.tenant_id).eq("user_id", agent.user_id).maybeSingle();
assert.equal(schema.error, null, schema.error?.message);
console.log(JSON.stringify({ ok: true, tenantId: agent.tenant_id, role: agent.role, settingsEndpoint: true, unauthorized: true, forged: true, hostileInput: true, concurrentWrites: true, duplicateSourceKey: true, restored: true }));
