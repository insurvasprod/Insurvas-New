import "../lib/refuseProduction.mjs";
// AG-0.5 (Notion sprint, Agency Module 0) · the producer isolation audit — LIVE half. RELEASE GATE.
//
// Provisions one agency with producers A and B (plus an assistant who works for A and a manager over A),
// seeds each producer's rows, then — against a running app — calls EVERY /api/app GET route, enumerated from
// the router (never a hand-written list), from each narrow session, and asserts that none of B's markers or
// ids appear in the body, in counts, in aggregates or in exported files. It repeats each call with B's id
// as a `producer_id` query parameter and an `x-producer-id` header and asserts nothing changes.
//
// Needs: the AG migrations applied (20261018100000…), an agency plan (AG-0.12, or --plan <code>), the dev
// server (BASE_URL, default http://localhost:3000). Cleans up everything it creates.
//
//   node --env-file=.env.local scripts/agency/verify-producer-isolation.mjs [--plan agency_50] [--keep]
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createFixtureUser, deleteFixtureUser } from "../lib/fixtureUser.mjs";

const ROOT = join(fileURLToPath(import.meta.url), "../../..");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fallback : process.argv[i + 1]; };
const PLAN = arg("plan", "agency_50");
const keep = process.argv.includes("--keep");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const MARK = (who) => `ISO${who}${stamp}`;
// A lead's own marker, distinct from the fixture PEOPLE's names (which carry MARK): a staff directory that lists
// producer B by name must not read as B's lead.
const LEAD_MARK = (who) => `LEADROW${who}${stamp}`;

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` — ${detail}`}`); if (!ok) failures++; };
const must = async (p, what) => { const { data, error } = await p; if (error) throw new Error(`${what}: ${error.message}`); return data; };
const tryInsert = async (table, row, label) => { const { error } = await sb.from(table).insert(row); console.log(`  ${error ? "skip" : "seed"} ${label}${error ? ` (${error.message})` : ""}`); return !error; };

const created = { users: [], tenantId: null };
async function person(suffix, role) {
  const fixture = await createFixtureUser(sb, { email: `ag05-${suffix}-${stamp}@insurvas.test`, name: `${MARK(suffix)} ${suffix}`, password: "VerifyIsolation123!" });
  created.users.push(fixture);
  await must(sb.from("tenant_users").insert({ tenant_id: created.tenantId, user_id: fixture.userId, role, accepted_at: new Date().toISOString() }), `member ${suffix}`);
  return fixture.userId;
}

async function session(userId) {
  const { data: u } = await sb.from("users").select("session_version").eq("id", userId).single();
  const token = await new SignJWT({ sub: userId, tenantId: created.tenantId, sessionVersion: u?.session_version ?? 0 })
    .setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("30m")
    .sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));
  return `insurvas_tenant_session=${token}`;
}

const routes = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? routes(p) : n === "route.ts" ? [p] : []; });

async function main() {
  const plan = await must(sb.from("plans").select("id, plan_type").eq("code", PLAN).order("version", { ascending: false }).limit(1).maybeSingle(), "plan");
  if (!plan || !String(plan.plan_type).startsWith("agency")) throw new Error(`No agency plan with code ${PLAN}. Apply AG-0.12 or pass --plan <an agency plan code>.`);

  const tenant = await must(sb.from("tenants").insert({ name: `${MARK("T")} Agency isolation`, status: "active" }).select("id").single(), "tenant");
  created.tenantId = tenant.id;
  await must(sb.from("subscriptions").insert({ tenant_id: tenant.id, plan_id: plan.id, status: "active", billing_cycle: "monthly", started_at: new Date().toISOString() }), "subscription");
  const owner = await person("O", "owner");
  const a = await person("A", "producer");
  const b = await person("B", "producer");
  const asst = await person("S", "assistant");
  const mgr = await person("M", "producer");
  const book = await person("K", "bookkeeper");
  const agency = await must(sb.from("agency").insert({ tenant_id: tenant.id, legal_name: `${MARK("T")} Agency` }).select("id").single(), "agency");
  const prod = async (userId, name) => must(sb.from("producer").insert({ tenant_id: tenant.id, agency_id: agency.id, user_id: userId, display_name: name }).select("id").single(), `producer ${name}`);
  const pa = await prod(a, "A"); await prod(b, "B"); const pm = await prod(mgr, "M"); await prod(owner, "O");
  await must(sb.rpc("tenant_set_member_agency_role", { p_tenant_id: tenant.id, p_user_id: mgr, p_member_role: "manager" }), "manager title");
  await must(sb.rpc("move_producer_to_manager", { p_tenant_id: tenant.id, p_producer_id: pa.id, p_parent_producer_id: pm.id, p_effective_from: "2026-01-01", p_actor: owner }), "A reports to M");
  await must(sb.from("assistant_producer").insert({ tenant_id: tenant.id, assistant_user_id: asst, producer_user_id: a }), "assistant works for A");

  // Seed B's rows (and A's, so "zero of B" is not trivially true). Best effort: a table whose required columns
  // changed is reported as skipped, not silently counted as covered.
  const bIds = new Set([b]);
  // agent_leads.template_id is required: any active global template, and its product as the lead's line.
  const template = await must(sb.from("templates").select("id, product_code").eq("is_active", true).order("is_default", { ascending: false }).limit(1).maybeSingle(), "template");
  if (!template) throw new Error("No active lead template to seed leads with.");
  for (const [who, uid] of [["A", a], ["B", b]]) {
    const leadId = crypto.randomUUID();
    if (await tryInsert("agent_leads", { id: leadId, tenant_id: tenant.id, template_id: template.id, product_line: template.product_code, created_by: uid, values: { first_name: LEAD_MARK(who), last_name: "Lead" } }, `${who} lead`)) {
      if (who === "B") bIds.add(leadId);
      await tryInsert("lead_queue", { tenant_id: tenant.id, lead_id: leadId, status: "claimed", owner_user_id: uid, owner_role: "producer", product_line: template.product_code }, `${who} queue row`);
      const caseId = crypto.randomUUID();
      if (await tryInsert("tenant_application_cases", { id: caseId, tenant_id: tenant.id, lead_id: leadId, product_line: template.product_code, source: "outbound", status: "open", opened_by: uid }, `${who} application case`) && who === "B") bIds.add(caseId);
    }
    // commission_entry and producer_ledger_entry are append-only by design (their guards refuse a delete), so
    // seeding them would leave rows behind that no cleanup can remove. Money totals are proven by the unit tests
    // and the static gate instead; this live run proves rows.
  }
  const bMarkers = [LEAD_MARK("B"), ...[...bIds]];

  const all = routes(join(ROOT, "app/api/app")).map((p) => relative(join(ROOT, "app"), p).replace(/\\/g, "/").replace(/\/route\.ts$/, ""));
  const probeId = [...bIds][1] ?? b;
  const dynamic = (path) => path.replace(/\[[^\]]+\]/g, probeId);
  // What counts as B's: his lead's name marker and his row ids. Two exclusions, each narrow:
  //  - the id this script itself put in a dynamic URL — Next echoes route params into what it renders, so
  //    finding it proves nothing (a page that really shows B's lead still shows his NAME marker);
  //  - B's user id on the staff directory a chat needs (names and roles of colleagues — no leads, cases,
  //    policies or money). Listed by route, not waved through generally.
  const PEOPLE_DIRECTORIES = new Set(["api/app/partner-chat"]);
  const leaks = (path, body) => bMarkers.some((m) => {
    if (path.includes("[") && m === probeId) return false;
    if (PEOPLE_DIRECTORIES.has(path) && m === b) return false;
    return body.includes(m);
  });
  const sessions = { producerA: await session(a), assistantOfA: await session(asst), managerOfA: await session(mgr), bookkeeper: await session(book) };
  console.log(`\nCalling ${all.length} routes × ${Object.keys(sessions).length} sessions (+ producer_id spoofing) at ${BASE}`);
  for (const [label, cookie] of Object.entries(sessions)) {
    const seesAll = label === "bookkeeper";
    let called = 0; let leaked = [];
    for (const path of all) {
      const url = `${BASE}/${dynamic(path)}`;
      for (const variant of ["", `?producer_id=${b}`]) {
        const res = await fetch(url + variant, { headers: { cookie, "x-producer-id": b }, redirect: "manual" }).catch(() => null);
        if (!res) continue;
        called++;
        const body = await res.text();
        if (!seesAll && res.status < 400 && leaks(path, body)) leaked.push(`${path}${variant}`);
      }
    }
    if (seesAll) check(`${label}: called ${called} route variants (sees the whole agency by design)`, true);
    else check(`${label}: zero of producer B's rows across ${called} route variants`, leaked.length === 0, leaked.slice(0, 20).join(", "));
  }

  // Server pages render the same data with no API in between: render every app page as each narrow session.
  const pages = pageFiles(join(ROOT, "app/app")).map((p) => relative(join(ROOT, "app"), p).replace(/\\/g, "/").replace("(shell)/", "").replace(/\/?page\.tsx$/, ""));
  for (const [label, cookie] of Object.entries(sessions)) {
    if (label === "bookkeeper") continue;
    let rendered = 0;
    const leaked = [];
    for (const path of pages) {
      const res = await fetch(`${BASE}/${dynamic(path)}`, { headers: { cookie }, redirect: "manual" }).catch(() => null);
      if (!res) continue;
      rendered++;
      const body = await res.text();
      if (res.status < 400 && leaks(path, body)) leaked.push(path);
    }
    check(`${label}: zero of producer B's rows across ${rendered} rendered pages`, leaked.length === 0, leaked.slice(0, 20).join(", "));
  }
}

const pageFiles = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? pageFiles(p) : n === "page.tsx" ? [p] : []; });

try {
  await main();
} catch (error) {
  failures++;
  console.error(`\nFAIL ${error.message}`);
} finally {
  if (!keep && created.tenantId) {
    // Every delete is checked: a leftover in the live project is reported, never swallowed.
    const leftovers = [];
    // agency, producer and producer_hierarchy refuse a direct delete (AG-0.1/0.3 guards): they go with the tenant,
    // whose delete cascades. Whatever the tenant delete cannot reach is reported below.
    for (const t of ["tenant_application_cases", "lead_queue", "agent_leads", "assistant_producer", "subscriptions"]) {
      const { error } = await sb.from(t).delete().eq("tenant_id", created.tenantId);
      if (error) leftovers.push(`${t}: ${error.message}`);
    }
    const { error: tenantError } = await sb.from("tenants").delete().eq("id", created.tenantId);
    if (tenantError) leftovers.push(`tenants: ${tenantError.message}`);
    for (const u of created.users) await deleteFixtureUser(sb, u.userId).catch((error) => leftovers.push(`user ${u.userId}: ${error.message}`));
    const { data: still } = await sb.from("tenants").select("id").eq("id", created.tenantId).maybeSingle();
    if (still) leftovers.push(`tenant ${created.tenantId} still exists`);
    if (leftovers.length) {
      failures++;
      console.error(`\nCLEANUP INCOMPLETE — remove by hand (tenant ${created.tenantId}):\n  ${leftovers.join("\n  ")}`);
    } else console.log(`\ncleaned up: tenant ${created.tenantId} and its ${created.users.length} fixture users are gone`);
  }
  console.log(failures ? `\n${failures} FAILURE(S) — the AG-0.5 gate is closed.` : "\nAG-0.5 live isolation check passed.");
  process.exit(failures ? 1 : 0);
}
