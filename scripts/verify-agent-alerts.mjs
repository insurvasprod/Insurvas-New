import "./lib/refuseProduction.mjs";
// LA-1.25 live acceptance and failure-path checks. Creates only disposable tenants and removes them.
//
// The previous version of this suite did two things worth calling out, because both are why it
// reported green while none of the six acceptance criteria had evidence.
//
// It picked a REAL tenant and a REAL agent -- `pickAgent()` selected any active membership in the
// database -- and then wrote that person's alert settings, restoring them afterwards. A suite that
// mutates production preferences is one crash away from leaving someone's notifications off.
//
// And it asserted the plumbing rather than the task: settings round-trip, 401s, hostile input,
// concurrent writes, duplicate source keys. All worth keeping, none of them one of the six criteria.
// It printed a single JSON blob instead of per-check lines, so a sweep could not see what was covered.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import { createFixtureUser, deleteFixtureUser, deleteLa1FixtureTenant } from "./lib/fixtureUser.mjs";
import { coalesceAlertBatch } from "../lib/agentAlerts/presentation.ts";
import { AUDIBLE, AUDIBLE_BY_DEFAULT, MIN_GAP_MS, decideSound } from "../lib/notify/sound.ts";

const BASE = process.env.APP_BASE_URL ?? process.env.APP_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID();
let agentId = null;
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } };

async function cookie(userId, tenant = tenantId, expired = false) {
  return `insurvas_tenant_session=${await new SignJWT({ tenantId: tenant }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 1 : "10m").sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET))}`;
}
async function api(path, session, options = {}) {
  return fetch(`${BASE}${path}`, { ...options, headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(session ? { cookie: session } : {}), ...(options.headers ?? {}) } });
}
async function cleanup() {
  await db.from("agent_notifications").delete().eq("tenant_id", tenantId);
  await db.from("agent_notification_settings").delete().eq("tenant_id", tenantId);
  await db.from("lead_queue").delete().eq("tenant_id", tenantId);
  await db.from("agent_leads").delete().eq("tenant_id", tenantId);
  await db.from("tenant_users").delete().eq("tenant_id", tenantId);
  await deleteLa1FixtureTenant(db, tenantId);
  if (agentId) await deleteFixtureUser(db, agentId);
}

async function main() {
  if (!process.env.TENANT_SESSION_SECRET) throw new Error("TENANT_SESSION_SECRET is required");
  await cleanup();
  try {
    const tenant = await db.from("tenants").insert({ id: tenantId, name: `LA-1.25 alerts ${stamp}`, status: "active", onboarding_state: "completed" });
    if (tenant.error) throw new Error(tenant.error.message);
    ({ userId: agentId } = await createFixtureUser(db, { email: `la125-agent-${stamp}@invalid.test`, name: "Alert agent" }));
    const membership = await db.from("tenant_users").insert({ tenant_id: tenantId, user_id: agentId, role: "producer" });
    if (membership.error) throw new Error(membership.error.message);
    const session = await cookie(agentId);

    // Two alerts of different types, so a filter that removes everything is distinguishable from one
    // that removes the right thing. Both are workspace alerts, which stay only while their lead is
    // unclaimed in the queue (lib/agentAlerts/presentation.ts partitionAlertRows) -- one pointing at
    // a lead with no queue row is "resolved" and retired on the first read. So each links to a real
    // lead with an unclaimed queue item.
    const pipeline = await db.from("tenant_pipelines").select("id").eq("tenant_id", tenantId).eq("partner_type", "publisher").eq("is_default", true).single();
    const stage = pipeline.data ? await db.from("tenant_pipeline_stages").select("id").eq("pipeline_id", pipeline.data.id).eq("is_archived", false).order("position").limit(1).single() : { data: null, error: new Error("no default pipeline") };
    const template = await db.from("templates").select("id").eq("product_code", "term_life").eq("is_active", true).limit(1).single();
    if (pipeline.error || stage.error || template.error) throw new Error(pipeline.error?.message ?? stage.error?.message ?? template.error?.message ?? "Fixture dependency missing");
    const [leadAlertLead, escalationLead] = [randomUUID(), randomUUID()];
    const leads = await db.from("agent_leads").insert([leadAlertLead, escalationLead].map((id, index) => ({ id, tenant_id: tenantId, template_id: template.data.id, template_version: 1, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, values: { full_name: `Alert Prospect ${index + 1}`, age: 70, state: "AZ" }, created_by: agentId, submission_id: randomUUID() })));
    if (leads.error) throw new Error(leads.error.message);
    const queued = await db.from("lead_queue").insert([leadAlertLead, escalationLead].map((leadId) => ({ id: randomUUID(), tenant_id: tenantId, lead_id: leadId, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id })));
    if (queued.error) throw new Error(queued.error.message);
    const seed = await db.from("agent_notifications").insert([
      { tenant_id: tenantId, recipient_user_id: agentId, kind: "new_unclaimed_lead", title: "New transfer waiting", body: "Apex Call Center", link: `/app/leads/${leadAlertLead}`, source_key: `la125-lead:${stamp}` },
      { tenant_id: tenantId, recipient_user_id: agentId, kind: "unclaimed_sla_escalation", title: "Nobody has taken this transfer", body: "2 minutes unclaimed", link: `/app/leads/${escalationLead}`, source_key: `la125-escalation:${stamp}` },
    ]);
    if (seed.error) throw new Error(seed.error.message);

    const initial = await api("/api/app/notifications", session);
    const initialBody = await initial.json();
    const kinds = (initialBody.alerts ?? []).map((alert) => alert.event_type).sort();
    check("both alert types reach the agent by default", initial.status === 200 && kinds.join(",") === "new_lead,unclaimed_escalation", JSON.stringify({ status: initial.status, kinds }));

    // Criterion 6: "every alert type can be turned off individually, and the setting persists".
    // Individually is the operative word -- listAgentAlerts filters per event type, so turning one
    // off must leave the other arriving.
    const disabled = { ...initialBody.settings, enabled_events: { ...initialBody.settings.enabled_events, new_lead: false } };
    const savedResponse = await api("/api/app/notifications", session, { method: "PATCH", body: JSON.stringify(disabled) });
    const afterDisable = await api("/api/app/notifications", session);
    const afterBody = await afterDisable.json();
    const remaining = (afterBody.alerts ?? []).map((alert) => alert.event_type);
    check("one alert type can be turned off without silencing the rest", savedResponse.status === 200 && remaining.join(",") === "unclaimed_escalation", JSON.stringify({ save: savedResponse.status, remaining }));

    // ...and persists. Re-read through a NEW request rather than trusting the PATCH response, which
    // is the server echoing what it was sent.
    const reread = await api("/api/app/notifications", session);
    const rereadBody = await reread.json();
    check("the alert setting persists across requests", rereadBody.settings?.enabled_events?.new_lead === false && rereadBody.settings?.enabled_events?.unclaimed_escalation === true, JSON.stringify(rereadBody.settings?.enabled_events));

    // Criterion 4, the half that matters: "do-not-disturb suppresses sound and browser notifications
    // but NEVER suppresses an escalation email". The failure worth ruling out is do-not-disturb
    // leaking into the server and silencing the escalation, so assert the server still hands the
    // escalation over with DND on -- DND is a presentation setting and must stay one.
    const dnd = { ...rereadBody.settings, do_not_disturb: true, enabled_events: { ...rereadBody.settings.enabled_events, new_lead: true } };
    const dndSaved = await api("/api/app/notifications", session, { method: "PATCH", body: JSON.stringify(dnd) });
    const underDnd = await api("/api/app/notifications", session);
    const underDndBody = await underDnd.json();
    const dndKinds = (underDndBody.alerts ?? []).map((alert) => alert.event_type).sort();
    check("do-not-disturb never withholds an alert server-side", dndSaved.status === 200 && underDndBody.settings?.do_not_disturb === true && dndKinds.join(",") === "new_lead,unclaimed_escalation", JSON.stringify({ dnd: underDndBody.settings?.do_not_disturb, dndKinds }));

    // ...and the escalation email is sent from the SLA processor, which must not consult these
    // settings at all. A source guard, because the alternative is asserting on an email transport.
    const slaSource = await readFile("lib/queueSla/service.ts", "utf8");
    const consultsSettings = /getAgentAlertSettings|do_not_disturb|sound_muted/.test(slaSource);
    check("the escalation email path does not read alert settings", /sendEmail/.test(slaSource) && !consultsSettings, consultsSettings ? "lib/queueSla/service.ts reads alert settings before sending" : "");

    // Criterion 5: "ten leads arriving at once produce one sound, not ten". The batching decision is
    // coalesceAlertBatch, and the component must call the sound once per batch rather than per alert.
    const ten = coalesceAlertBatch(Array.from({ length: 10 }, (_, index) => ({ id: `alert-${index}` })));
    const none = coalesceAlertBatch([]);
    check("a burst of ten alerts yields a single sound decision", ten.alerts.length === 10 && ten.playSound === true && none.playSound === false, JSON.stringify({ ten: ten.playSound, none: none.playSound }));
    // The delivery logic lives in the shared feed hook; the agent plane's surface for it is the top
    // bar. These were one component until the hook was extracted, which is why both are read here.
    const feed = await readFile("lib/agentAlerts/useAgentAlertFeed.ts", "utf8");
    // The browser-alert controls live in the preferences panel the top bar opens.
    const centre = await readFile("components/app/agent-alert-preferences.tsx", "utf8");
    // Count inside the delivery function only. The hook legitimately calls playAlertSound from
    // two other places -- its own definition, and the "test sound" button in settings -- so a count
    // across the whole file measures nothing. What matters is that the one code path which runs when
    // alerts arrive calls it once, outside the per-alert loop.
    const deliverStart = feed.indexOf("const deliver = useCallback(");
    const deliverBody = deliverStart < 0 ? "" : feed.slice(deliverStart, feed.indexOf("}, []);", deliverStart));
    // The sound moved out of deliver() into the notification layer: each fresh alert is one
    // `notify.arrive` toast, and lib/notify/sound.ts decides the sound -- one per MIN_GAP_MS at most.
    // So "one sound per batch" is now: deliver() plays nothing itself (a second, legacy player would
    // give one alert two sounds), every alert goes through `arrive`, and the one sound policy turns a
    // same-instant burst of ten `arrive`s into exactly one "play".
    const directSoundCalls = (deliverBody.match(/playAlertSound\(|playFor\(|new Audio\(/g) ?? []).length;
    const arriveInLoop = /fresh\.forEach\(\(alert\) => \{\s*notify\.arrive\(/.test(deliverBody);
    let lastPlayedAt = -Infinity; const burstAt = 1_000_000; let plays = 0;
    for (let index = 0; index < 10; index += 1) {
      const decision = decideSound("arrive", { primed: true, callOpen: false, muted: false, enabled: true, volume: 70, msSinceLast: burstAt - lastPlayedAt });
      if (decision === "play") { plays += 1; lastPlayedAt = burstAt; }
    }
    check("the sound is played once per batch, not once per alert", Boolean(deliverBody) && directSoundCalls === 0 && arriveInLoop && AUDIBLE.includes("arrive") && plays === 1 && MIN_GAP_MS >= 1000, JSON.stringify({ directSoundCalls, arriveInLoop, playsForTenAtOnce: plays, MIN_GAP_MS }));

    // Criterion 3: "denied browser permission degrades to toast plus sound, and offers a clear way to
    // re-enable". The degradation is a matter of ordering in the delivery loop, and it is the kind of
    // thing a refactor silently inverts: the toast must be raised BEFORE the permission guard, so a
    // denied permission costs the browser notification and nothing else. Whether the notification
    // itself appears needs a real browser and is not claimed here.
    const toastAt = deliverBody.indexOf("notify.arrive(");
    const permissionGuardAt = deliverBody.indexOf("Notification.permission");
    const dndReturnAt = deliverBody.indexOf("do_not_disturb || typeof Notification");
    check("a denied browser permission still leaves the toast", toastAt > 0 && permissionGuardAt > toastAt && dndReturnAt > toastAt, JSON.stringify({ toastAt, permissionGuardAt, dndReturnAt }));
    // ...and the sound is decided before any of that, so it survives a denial too.
    // The sound rides on the `arrive` toast, so the toast ordering above is also the sound's.
    check("a denied browser permission still leaves the sound", toastAt > 0 && toastAt < permissionGuardAt && AUDIBLE_BY_DEFAULT.includes("arrive"), JSON.stringify({ toastAt, permissionGuardAt }));
    // ...and there is a way back. The settings panel offers the permission request explicitly rather
    // than relying on the browser ever asking again, which it will not once denied.
    check("the settings panel offers a way to re-enable browser alerts", /requestBrowserAlerts\(\)/.test(centre) && /Notification\.requestPermission\(\)/.test(feed));
    // The label is an inline ternary on the button rather than a named variable, so assert the copy.
    check("the default browser permission has an enable action label", /Enable browser alerts/.test(centre) && /Browser alerts are enabled/.test(centre));
    // The top bar states the limitation in the button's own label and disables it, rather than in a
    // separate paragraph beneath. Same criterion, one element instead of two.
    check("an unsupported browser explains the limitation without offering a dead action", /permission === "unsupported" \|\| feed\.permission === "granted"/.test(centre) && /Browser alerts unavailable in this browser/.test(centre));

    // Failure paths. These were the whole of the previous suite and are worth keeping.
    check("missing, forged and expired sessions fail closed", (await api("/api/app/notifications")).status === 401 && (await api("/api/app/notifications", "insurvas_tenant_session=forged")).status === 401 && (await api("/api/app/notifications", await cookie(agentId, tenantId, true))).status === 401);
    check("an admin-plane cookie cannot authenticate the agent endpoint", (await api("/api/app/notifications", "insurvas_admin_session=not-an-agent-session")).status === 401);
    const hostile = await api("/api/app/notifications", session, { method: "PATCH", body: JSON.stringify({ enabled_events: "<script>alert(1)</script>", do_not_disturb: "yes", sound_volume: 10_000 }) });
    check("hostile settings input is rejected or coerced, never stored raw", hostile.status === 400 || (await (await api("/api/app/notifications", session)).json()).settings?.sound_volume <= 100, `status ${hostile.status}`);
    const otherTenantId = randomUUID();
    check("a session for another tenant cannot read these alerts", (await api("/api/app/notifications", await cookie(agentId, otherTenantId))).status !== 200 || ((await (await api("/api/app/notifications", await cookie(agentId, otherTenantId))).json()).alerts ?? []).length === 0);
    const concurrent = await Promise.all([
      api("/api/app/notifications", session, { method: "PATCH", body: JSON.stringify({ ...dnd, sound_volume: 30 }) }),
      api("/api/app/notifications", session, { method: "PATCH", body: JSON.stringify({ ...dnd, sound_volume: 60 }) }),
    ]);
    const settled = await (await api("/api/app/notifications", session)).json();
    check("concurrent settings writes leave one coherent result", concurrent.every((response) => response.status === 200) && [30, 60].includes(settled.settings?.sound_volume), JSON.stringify({ volume: settled.settings?.sound_volume }));
  } finally { await cleanup(); }
  console.log(failures ? `\n${failures} LA-1.25 check(s) FAILED.` : "\nAll LA-1.25 agent alert checks passed.");
  return failures ? 1 : 0;
}

process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
