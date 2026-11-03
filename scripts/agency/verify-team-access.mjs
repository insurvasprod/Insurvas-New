import "../lib/refuseProduction.mjs";
// Custom team access (Notion AG-1.13, docs/team-access/DESIGN.md) · the LIVE walk with combined members.
//
// Provisions one agency on an agency plan with an owner, an admin, producers A and B, a producer who is also the
// bookkeeper (PB), an assistant who is also a setter (AS, working for A) and a plain assistant. Then, against a
// running app:
//   · without the add-on the access route refuses;
//   · attaches the real custom_team_access add-on to the subscription and sets access THROUGH THE API as the owner;
//   · checks the database's view (roles, acting role, AG-0.4 visibility) and what each session can open;
//   · hides a page for A and checks the notice; presets; the refusals (self, billing owner, extra = main role);
//   · detaches the add-on and checks the extras go dormant.
// Cleans up everything it creates (audit_log rows are append-only and stay, naming the deleted fixture ids).
//
//   VERIFY_ALLOW_PRODUCTION=1 BASE_URL=http://localhost:3100 node --env-file=.env.local scripts/agency/verify-team-access.mjs
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { createFixtureUser, deleteFixtureUser } from "../lib/fixtureUser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const keep = process.argv.includes("--keep");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const ROLE_NOTICE = "Your role does not include";
const HIDDEN_NOTICE = "is hidden for you";

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` — ${detail}`}`); if (!ok) failures++; };
const must = async (p, what) => { const { data, error } = await p; if (error) throw new Error(`${what}: ${error.message}`); return data; };

const created = { users: [], tenantId: null, subscriptionId: null };
async function person(suffix, role) {
  const fixture = await createFixtureUser(sb, { email: `ta-${suffix.toLowerCase()}-${stamp}@insurvas.test`, name: `TA${suffix}${stamp}`, password: "VerifyTeamAccess123!" });
  created.users.push(fixture);
  await must(sb.from("tenant_users").insert({ tenant_id: created.tenantId, user_id: fixture.userId, role, accepted_at: new Date().toISOString() }), `member ${suffix}`);
  // The shell sends anyone with outstanding terms to /app/accept-terms; accept them (they go with the user).
  const outstanding = (await sb.rpc("outstanding_legal_documents", { p_user_id: fixture.userId })).data ?? [];
  const ids = outstanding.map((doc) => doc.id ?? doc.document_id).filter(Boolean);
  if (ids.length) await must(sb.rpc("record_legal_acceptances", { p_user_id: fixture.userId, p_document_ids: ids, p_ip: null, p_user_agent: "verify-team-access", p_context: null }), `terms ${suffix}`);
  return fixture.userId;
}
async function session(userId) {
  const { data: u } = await sb.from("users").select("session_version").eq("id", userId).single();
  const token = await new SignJWT({ sub: userId, tenantId: created.tenantId, sessionVersion: u?.session_version ?? 0 })
    .setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("30m")
    .sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));
  return `insurvas_tenant_session=${token}`;
}
const call = async (cookie, path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { cookie, "content-type": "application/json", origin: BASE, ...(init.headers ?? {}) }, redirect: "manual" });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* a page */ }
  return { status: res.status, text, json, where: res.headers.get("location") };
};
// The sidebar arrives as the shell's serialized menu (escaped JSON in the RSC payload), not as rendered links.
const menuHas = (text, path) => text.includes(`\\"path\\":\\"${path}\\"`) || text.includes(`"path":"${path}"`);
const setAccess =(cookie, userId, extraRoles, hiddenPages = []) => call(cookie, `/api/app/team/${userId}/access`, { method: "PUT", body: JSON.stringify({ extraRoles, hiddenPages }) });
const refresh = () => must(sb.rpc("refresh_tenant_entitlement", { p_tenant_id: created.tenantId }), "refresh entitlement");
const rpc = async (name, args) => (await sb.rpc(name, args)).data;

async function main() {
  const plan = await must(sb.from("plans").select("id").eq("code", "agency_50").order("version", { ascending: false }).limit(1).maybeSingle(), "plan");
  const addon = await must(sb.from("addons").select("id").eq("code", "custom_team_access").maybeSingle(), "addon");
  if (!plan || !addon) throw new Error("Needs the agency_50 plan and the custom_team_access add-on (20261020500000).");
  const tenant = await must(sb.from("tenants").insert({ name: `TA${stamp} Team access walk`, status: "active" }).select("id").single(), "tenant");
  created.tenantId = tenant.id;
  const sub = await must(sb.from("subscriptions").insert({ tenant_id: tenant.id, plan_id: plan.id, status: "active", billing_cycle: "monthly", started_at: new Date().toISOString() }).select("id").single(), "subscription");
  created.subscriptionId = sub.id;
  const owner = await person("O", "owner");
  const admin = await person("D", "owner");
  const a = await person("A", "producer");
  const b = await person("B", "producer");
  const pb = await person("PB", "producer");
  const as = await person("AS", "assistant");
  const asst = await person("S", "assistant");
  const agency = await must(sb.from("agency").insert({ tenant_id: tenant.id, legal_name: `TA${stamp} Agency` }).select("id").single(), "agency");
  for (const [uid, name] of [[owner, "O"], [a, "A"], [b, "B"], [pb, "PB"]]) await must(sb.from("producer").insert({ tenant_id: tenant.id, agency_id: agency.id, user_id: uid, display_name: name }), `producer ${name}`);
  await must(sb.rpc("tenant_set_member_agency_role", { p_tenant_id: tenant.id, p_user_id: admin, p_member_role: "admin" }), "admin title");
  await must(sb.from("assistant_producer").insert({ tenant_id: tenant.id, assistant_user_id: as, producer_user_id: a }), "AS works for A");
  await refresh();
  const s = { owner: await session(owner), admin: await session(admin), a: await session(a), pb: await session(pb), as: await session(as), asst: await session(asst) };

  console.log("\nWithout the add-on");
  check("the access route refuses (feature not on the plan)", (await setAccess(s.owner, pb, ["bookkeeper"])).status === 403);
  check("the database refuses an extra role too", Boolean((await sb.rpc("tenant_set_member_access", { p_tenant_id: tenant.id, p_actor: owner, p_user_id: pb, p_extra_roles: ["bookkeeper"], p_hidden_pages: [] })).error));

  console.log("\nWith the add-on attached to the subscription");
  const attach = await sb.from("subscription_addons").insert({ subscription_id: sub.id, addon_id: addon.id, availability_overridden: true }).select("id").single();
  if (attach.error) throw new Error(`attach add-on: ${attach.error.message}`);
  await refresh();
  let r = await setAccess(s.owner, pb, ["bookkeeper"]);
  check("owner gives PB the bookkeeper role", r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
  r = await setAccess(s.admin, as, ["setter"]);
  check("an admin gives AS the setter role", r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
  r = await setAccess(s.owner, owner, ["producer"]);
  check("nobody changes their own access", r.status === 403 && r.json?.code === "TEAM_ACCESS_NOT_SELF", `${r.status} ${r.json?.code}`);
  r = await setAccess(s.admin, owner, [], ["book.ledger"]);
  check("an admin cannot change the billing owner", r.status === 403 && r.json?.code === "TEAM_ACCESS_BILLING_OWNER", `${r.status} ${r.json?.code}`);
  r = await setAccess(s.owner, pb, ["producer"]);
  check("an extra role cannot be the main role", r.status === 400 && r.json?.code === "TEAM_ACCESS_ROLE_IS_MAIN", `${r.status} ${r.json?.code}`);
  r = await setAccess(s.a, b, ["bookkeeper"]);
  check("a producer cannot set anyone's access", r.status === 403);

  console.log("\nThe database's view");
  check("PB holds producer + bookkeeper", JSON.stringify(await rpc("tenant_member_roles", { p_tenant_id: tenant.id, p_user_id: pb })) === '["producer","bookkeeper"]');
  check("PB acts as bookkeeper where only owner/bookkeeper may", (await rpc("tenant_member_acting_role", { p_tenant_id: tenant.id, p_user_id: pb, p_allowed: ["owner", "bookkeeper"] })) === "bookkeeper");
  check("PB acts as producer where producers may (main role first)", (await rpc("tenant_member_acting_role", { p_tenant_id: tenant.id, p_user_id: pb, p_allowed: ["owner", "producer", "bookkeeper"] })) === "producer");
  check("PB sees the whole agency (bookkeeper is all-seeing)", (await rpc("agency_visible_user_ids", { p_tenant_id: tenant.id, p_user_id: pb })) === null);
  const asSees = (await rpc("agency_visible_user_ids", { p_tenant_id: tenant.id, p_user_id: as })) ?? [];
  check("AS sees himself and A, never B", asSees.includes(as) && asSees.includes(a) && !asSees.includes(b) && asSees.length === 2, JSON.stringify(asSees));
  check("a plain assistant's view is unchanged (nobody assigned: nothing)", JSON.stringify(await rpc("agency_visible_user_ids", { p_tenant_id: tenant.id, p_user_id: asst })) === "[]");
  check("A, one role, acts as himself", (await rpc("tenant_member_acting_role", { p_tenant_id: tenant.id, p_user_id: a, p_allowed: ["owner", "bookkeeper"] })) === "producer");

  console.log("\nWhat each session opens");
  check("PB opens the payout-runs API (bookkeeper)", (await call(s.pb, "/api/app/agency/payouts")).status === 200);
  check("A, a plain producer, does not", (await call(s.a, "/api/app/agency/payouts")).status === 403);
  let page = await call(s.pb, "/app/producer-payouts");
  check("PB opens the Payout runs page", page.status === 200 && !page.text.includes(ROLE_NOTICE), `${page.status} ${page.where ?? ""}`);
  check("PB's menu offers Payout runs; A's does not", menuHas((await call(s.pb, "/app/settings")).text, "/app/producer-payouts") && !menuHas((await call(s.a, "/app/settings")).text, "/app/producer-payouts"));
  page = await call(s.a, "/app/producer-payouts");
  check("A gets the role notice on Payout runs", page.text.includes(ROLE_NOTICE));
  check("AS opens Activity (setter)", (await call(s.as, "/api/app/activity")).status === 200);
  check("a plain assistant does not", (await call(s.asst, "/api/app/activity")).status === 403);
  page = await call(s.as, "/app/producer-payouts");
  check("AS still gets the role notice on Payout runs (no money role)", page.text.includes(ROLE_NOTICE));
  check("AS cannot open the payout-runs API", (await call(s.as, "/api/app/agency/payouts")).status === 403);

  console.log("\nHidden pages");
  page = await call(s.a, "/app/ledger");
  check("A opens the ledger before it is hidden", page.status === 200 && !page.text.includes(HIDDEN_NOTICE), `${page.status} ${page.where ?? ""}`);
  check("A's menu offers the ledger before it is hidden", menuHas(page.text, "/app/ledger"));
  r = await setAccess(s.owner, a, [], ["book.ledger"]);
  check("owner hides the ledger for A", r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
  page = await call(s.a, "/app/ledger");
  check("A's ledger page now answers with the hidden notice", page.text.includes(HIDDEN_NOTICE));
  check("A's menu no longer offers the ledger", !menuHas(page.text, "/app/ledger"));
  r = await setAccess(s.owner, a, [], ["settings.root"]);
  check("Settings cannot be hidden", r.status === 400);

  console.log("\nPresets");
  const preset = { name: "Producer + books", mainRole: "producer", extraRoles: ["bookkeeper"], hiddenPages: [] };
  r = await call(s.owner, "/api/app/team/presets", { method: "POST", body: JSON.stringify(preset) });
  check("owner saves a preset", r.status === 201, `${r.status} ${r.text.slice(0, 160)}`);
  const presetId = r.json?.id;
  check("the same name again is refused, not overwritten", (await call(s.owner, "/api/app/team/presets", { method: "POST", body: JSON.stringify({ ...preset, name: "producer + BOOKS" }) })).status === 409);
  check("the team snapshot lists it", ((await call(s.owner, "/api/app/team")).json?.teamAccess?.presets ?? []).some((p) => p.id === presetId));
  check("a producer cannot save presets", (await call(s.a, "/api/app/team/presets", { method: "POST", body: JSON.stringify({ ...preset, name: "x" }) })).status === 403);
  check("owner deletes it", presetId ? (await call(s.owner, `/api/app/team/presets/${presetId}`, { method: "DELETE" })).status === 200 : false);

  const audits = await sb.from("audit_log").select("id", { count: "exact", head: true }).eq("action", "tenant.member_access_changed").in("target_id", [pb, as, a]);
  check("every access change is audited", (audits.count ?? 0) >= 3, `${audits.count ?? audits.error?.message}`);

  console.log("\nAdd-on switched off");
  await must(sb.from("subscription_addons").update({ detached_at: new Date().toISOString() }).eq("id", attach.data.id), "detach add-on");
  await refresh();
  check("PB's extra role is dormant: payout-runs API refused", (await call(s.pb, "/api/app/agency/payouts")).status === 403);
  check("PB is back to his own rows", JSON.stringify(await rpc("agency_visible_user_ids", { p_tenant_id: tenant.id, p_user_id: pb })) === JSON.stringify([pb]));
  page = await call(s.a, "/app/ledger");
  check("A's hidden page is shown again", page.status === 200 && !page.text.includes(HIDDEN_NOTICE), `${page.status} ${page.where ?? ""}`);
}

try {
  await main();
} catch (error) {
  failures++;
  console.error(`\nFAIL ${error.message}`);
} finally {
  if (!keep && created.tenantId) {
    const leftovers = [];
    // Access changes write Settings history (LA-8.8), which only the platform purge may remove. So: cancel the
    // subscription and purge the workspace, as SA does. The purge keeps the billing rows and its own record, so the
    // tenant row stays as an empty, cancelled shell. That is the purge's designed end state.
    await sb.from("subscriptions").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("tenant_id", created.tenantId);
    const { data: tenantRow } = await sb.from("tenants").select("name").eq("id", created.tenantId).maybeSingle();
    if (tenantRow) {
      const purge = await sb.rpc("purge_tenant_workspace", { p_tenant_id: created.tenantId, p_actor: null, p_reason: "Custom team access live walk fixture cleanup", p_confirm_name: tenantRow.name });
      if (purge.error) leftovers.push(`purge: ${purge.error.message}`);
    }
    for (const u of created.users) await deleteFixtureUser(sb, u.userId).catch((error) => leftovers.push(`user ${u.userId}: ${error.message}`));
    const { count: members } = await sb.from("tenant_users").select("user_id", { count: "exact", head: true }).eq("tenant_id", created.tenantId);
    if (members) leftovers.push(`${members} membership rows still exist`);
    if (leftovers.length) {
      failures++;
      console.error(`\nCLEANUP INCOMPLETE — remove by hand (tenant ${created.tenantId}):\n  ${leftovers.join("\n  ")}`);
    } else console.log(`\ncleaned up: workspace ${created.tenantId} purged (an empty, cancelled shell remains by design); its ${created.users.length} fixture users are gone`);
  }
  console.log(failures ? `\n${failures} FAILURE(S).` : "\nCustom team access live walk passed.");
  process.exit(failures ? 1 : 0);
}
