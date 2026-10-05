import "./lib/refuseProduction.mjs";
// LA-1.19 live contract checks. Run with: npm run verify:subscription-limits
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import { createFixtureUser, deleteFixtureUser } from "./lib/fixtureUser.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID(); const otherTenantId = randomUUID();
let ownerId = null; let producerId = null; let otherOwnerId = null;
let failures = 0; let partnerId = null; let secondPartnerId = null;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures += 1; } };
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const partner = (name, type = "publisher") => ({ name, partner_type: type, country: "US", contact_name: "QA", contact_email: `${name.toLowerCase().replaceAll(" ", "-")}@invalid.test`, timezone: "America/Phoenix", notes: "LA-1.19 verification" });
async function session(userId, tenant = tenantId, expires = "10m") { return new SignJWT({ tenantId: tenant }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(expires).sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET)); }
async function api(path, token, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie: `insurvas_tenant_session=${token}`, ...(options.headers ?? {}) } }); }
async function cleanup() {
  await db.from("agent_leads").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("partner_users").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("partner_terms").delete().in("partner_id", [partnerId, secondPartnerId].filter(Boolean));
  // Every partner the run made (drafts included), not only the two ids it kept.
  await db.from("partners").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("tenant_entitlements").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("audit_log").delete().in("actor_id", [ownerId, producerId, otherOwnerId]);
  await db.from("tenant_users").delete().in("tenant_id", [tenantId, otherTenantId]);
  for (const id of [ownerId, producerId, otherOwnerId]) await deleteFixtureUser(db, id);
  await db.from("tenants").delete().in("id", [tenantId, otherTenantId]);
}
async function main() {
  const probe = await db.rpc("create_partner_with_limits", { p_tenant_id: tenantId, p_name: "probe", p_partner_type: "publisher", p_country: "US", p_contact_name: "", p_contact_email: "", p_timezone: "UTC", p_notes: "", p_created_by: ownerId, p_max_publishers: 0, p_max_marketing_partners: null, p_max_affiliates: null });
  if (probe.error && /does not exist|could not find/i.test(probe.error.message)) { console.error("LA-1.19 migration is not applied to the connected database."); return 2; }
  await cleanup();
  const setup = await db.from("tenants").insert([{ id: tenantId, name: `LA-1.19 ${stamp}`, status: "active", onboarding_state: "completed" }, { id: otherTenantId, name: `LA-1.19 other ${stamp}`, status: "active", onboarding_state: "completed" }]);
  if (setup.error) throw new Error(setup.error.message);
  ({ userId: ownerId } = await createFixtureUser(db, { email: `la19-owner-${stamp}@invalid.test`, name: "LA-1.19 owner" }));
  ({ userId: producerId } = await createFixtureUser(db, { email: `la19-producer-${stamp}@invalid.test`, name: "LA-1.19 producer" }));
  ({ userId: otherOwnerId } = await createFixtureUser(db, { email: `la19-other-${stamp}@invalid.test`, name: "LA-1.19 other" }));
  const members = await db.from("tenant_users").insert([{ tenant_id: tenantId, user_id: ownerId, role: "owner" }, { tenant_id: tenantId, user_id: producerId, role: "producer" }, { tenant_id: otherTenantId, user_id: otherOwnerId, role: "owner" }]);
  if (members.error) throw new Error(members.error.message);
  const entitlement = { tenant_id: tenantId, plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["publisher_records"], meters: {}, limits: { max_seats: 5, max_publishers: 1, max_marketing_partners: 1, max_affiliates: 1, max_buffer_seats: 1, max_partner_users: 1 } };
  const grants = await db.from("tenant_entitlements").insert([{ tenant_id: tenantId, entitlement }, { tenant_id: otherTenantId, entitlement: { ...entitlement, tenant_id: otherTenantId } }]);
  if (grants.error) throw new Error(grants.error.message);
  const owner = await session(ownerId); const producer = await session(producerId); const other = await session(otherOwnerId, otherTenantId);
  try {
    check("missing, forged and expired sessions fail closed", (await fetch(`${BASE}/api/app/partners`)).status === 401 && (await api("/api/app/partners", "forged")).status === 401 && (await api("/api/app/partners", await session(ownerId, tenantId, "-1s"))).status === 401);
    check("wrong tenant role cannot create", (await api("/api/app/partners", producer, { method: "POST", ...json(partner("wrong role")) })).status === 403);
    check("hostile input is rejected", (await api("/api/app/partners", owner, { method: "POST", ...json(partner("<script>alert(1)</script>")) })).status === 400);
    const created = await api("/api/app/partners", owner, { method: "POST", ...json(partner("Publisher one")) }); const createdBody = await created.json(); partnerId = createdBody.partner?.id;
    check("first publisher is created", created.status === 201 && Boolean(partnerId));
    // LA-1.19 (user decision, 2026-09-25): only an ACTIVE partner holds a slot. A repeated create
    // makes a second draft, and neither draft takes a slot until it is activated.
    const repeated = await api("/api/app/partners", owner, { method: "POST", ...json(partner("Publisher one")) }); const repeatedBody = await repeated.json(); secondPartnerId = repeatedBody.partner?.id ?? null;
    const usageAfterDrafts = await (await api("/api/app/partners", owner)).json();
    check("repeating the same create request cannot consume a capacity slot (drafts hold none)", repeated.status === 201 && repeatedBody.partner?.status === "draft" && usageAfterDrafts.usage?.publishers === 0, JSON.stringify({ status: repeated.status, usage: usageAfterDrafts.usage }));
    const activated = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "active", reason: "capacity test" }) });
    check("activating a partner consumes its type capacity", activated.status === 200);
    const over = await api("/api/app/partners", owner, { method: "POST", ...json(partner("Publisher two")) }); const overBody = await over.json();
    check("hand-crafted create over max_publishers is 403 and specific", over.status === 403 && overBody.code === "limit_reached" && overBody.limitKey === "max_publishers");
    const secondActivation = await api(`/api/app/partners/${secondPartnerId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "active", reason: "capacity test" }) }); const secondActivationBody = await secondActivation.json().catch(() => ({}));
    check("activating a second draft at the cap is 403 and names the limit", secondActivation.status === 403 && secondActivationBody.limitKey === "max_publishers" && /active publisher/.test(secondActivationBody.error ?? ""), JSON.stringify({ status: secondActivation.status, body: secondActivationBody }));
    const concurrent = await Promise.all([api("/api/app/partners", owner, { method: "POST", ...json(partner("Concurrent one")) }), api("/api/app/partners", owner, { method: "POST", ...json(partner("Concurrent two")) })]);
    check("concurrent creates cannot overrun the cap", concurrent.filter((r) => r.status === 201).length === 0 && concurrent.every((r) => r.status === 403));
    const paused = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "active", reason: "already active" }) });
    check("invalid lifecycle transition does not mutate", paused.status === 409 || paused.status === 400);
    // Criterion 2 is two claims: "pausing a partner frees a slot immediately" and "unpausing over the
    // cap is blocked with a clear reason". The check here previously asserted that pause returned 200
    // and unpause returned 200 -- which is the situation where the cap is NOT reached, so it proved
    // neither half. Unpausing over the cap is the interesting one and it was never exercised.
    //
    // max_publishers is 1 and this partner is the one active publisher, so:
    const pause = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "paused", reason: "capacity test" }) });
    // ...the slot must be free immediately, with no rebuild step in between. This is the rotation the
    // task calls out: swapping a bad publisher for a good one must not need an upgrade.
    const afterPause = await api("/api/app/partners", owner, { method: "POST", ...json(partner("Replacement publisher")) }); const afterPauseBody = await afterPause.json();
    const replacementId = afterPauseBody.partner?.id;
    check("pausing a partner frees its slot immediately", pause.status === 200 && afterPause.status === 201 && Boolean(replacementId), JSON.stringify({ pause: pause.status, create: afterPause.status }));
    const activatedReplacement = await api(`/api/app/partners/${replacementId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "active", reason: "capacity test" }) });
    // ...and with the replacement active, bringing the paused one back would be a second active
    // publisher on a plan that allows one. That must fail, and say which limit and by how much.
    const resumed = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "active", reason: "capacity test" }) });
    const resumedBody = await resumed.json().catch(() => ({}));
    check("unpausing over the cap is blocked with a reason naming the limit", activatedReplacement.status === 200 && resumed.status === 403 && resumedBody.code === "limit_reached" && resumedBody.limitKey === "max_publishers" && resumedBody.limit === 1 && typeof resumedBody.error === "string" && /active publisher/.test(resumedBody.error) && !/max_publishers/.test(resumedBody.error) && /upgrade/i.test(resumedBody.error), JSON.stringify({ activate: activatedReplacement.status, resume: resumed.status, body: resumedBody }));
    // Put the fixture back the way the checks below expect it: one active publisher, at the cap.
    await api(`/api/app/partners/${replacementId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "paused", reason: "restore fixture" }) });
    await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "active", reason: "restore fixture" }) });
    // Criterion 4 is "every limited screen shows current usage against the cap" -- five limits, not
    // one. Asserting only max_publishers left four caps unproven, and they are served by two
    // different endpoints: the partner types and total closers come from the partners list, buffer
    // seats from the team snapshot. A screen that knows its cap but not its usage cannot render
    // "8 of 10", which is the whole of this criterion.
    const list = await api("/api/app/partners", owner); const listBody = await list.json();
    const team = await api("/api/app/team", owner); const teamBody = await team.json();
    const capsPresent = ["max_publishers", "max_marketing_partners", "max_affiliates", "max_partner_users"].filter((key) => typeof listBody.limits?.[key] !== "number");
    const usagePresent = ["publishers", "marketing", "affiliates", "partnerUsers"].filter((key) => typeof listBody.usage?.[key] !== "number");
    check("every capped surface reports usage against its cap", list.status === 200 && team.status === 200 && capsPresent.length === 0 && usagePresent.length === 0 && listBody.limits.max_publishers === 1 && typeof teamBody.bufferSeats?.used === "number" && teamBody.bufferSeats?.max === 1 && typeof teamBody.seats?.used === "number", JSON.stringify({ missingCaps: capsPresent, missingUsage: usagePresent, bufferSeats: teamBody.bufferSeats, teamStatus: team.status }));
    // The one seat rule (20260924346000): the seats the team screen reports are the members who hold
    // one (active, suspended, not-yet-accepted), and buffer seats are the assistants among them.
    const holdsSeat = (member) => ["active", "suspended", "invited", "pending_verification"].includes(member.status);
    const heldMembers = (teamBody.members ?? []).filter(holdsSeat);
    check("seat usage counts only members who hold a seat", teamBody.seats?.used === heldMembers.length && teamBody.bufferSeats?.used === heldMembers.filter((member) => member.role === "assistant").length, JSON.stringify({ seats: teamBody.seats, bufferSeats: teamBody.bufferSeats }));
    const otherList = await api("/api/app/partners", other); const otherBody = await otherList.json();
    check("tenant scope cannot cross-read", otherList.status === 200 && !otherBody.partners?.some((p) => p.id === partnerId));
    const lowered = await db.from("tenant_entitlements").update({ entitlement: { ...entitlement, limits: { ...entitlement.limits, max_publishers: 0 } } }).eq("tenant_id", tenantId);
    check("downgrade below current usage keeps existing data", !lowered.error && (await api("/api/app/partners", owner)).status === 200);
    const blockedAfterDowngrade = await api("/api/app/partners", owner, { method: "POST", ...json(partner("After downgrade")) });
    check("downgrade blocks new creation without deleting history", blockedAfterDowngrade.status === 403);
  } finally { await cleanup(); }
  if (failures) return 1;
  console.log("\nAll live LA-1.19 subscription-limit checks passed."); return 0;
}
process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
