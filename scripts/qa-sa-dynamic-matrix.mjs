/**
 * SA dynamic-route matrix: the 35 `[id]` admin routes, probed as every admin role.
 *
 * Run with: npm run qa:sa-dynamic -- --out <file.json>
 *
 * ## Why this exists
 *
 * `qa:sa-matrix` probes GET-only static routes and skips every dynamic one, on the reasonable
 * grounds that "a read-only probe cannot invent a real id". The consequence is that everything
 * proven about the admin surface is proven about READS — while the acceptance criteria that matter
 * most are about writes:
 *
 *   SA-0.1  "a support_agent calling a super_admin route gets 403 from the API, not just a hidden
 *            button"
 *   SA-3.3  "a support_agent cannot open invoice screens at all"
 *   SA-3.8  "the requesting admin cannot approve their own request, even as super_admin"
 *   SA-2.8  "hiding a menu item is not security. The API check is the only real one."
 *
 * None of those had ever been exercised against a route.
 *
 * ## How it is safe to run against the shared project
 *
 * Every probe substitutes a **freshly generated UUID** for each dynamic segment. No such row
 * exists, so a PATCH or DELETE matches nothing and a nested POST (`/users/:id/suspend`,
 * `/plans/:id/new-version`) has no subject to act on. The bodies are empty objects, so any route
 * that validates before looking up also refuses. Nothing shared is created, renamed or removed.
 *
 * This deliberately tests authorization rather than behaviour, because authorization is the half
 * that can be tested without mutating anything — and it is the half the criteria are about.
 * Authorization runs before the row lookup in a correctly written route, which is exactly what
 * makes the 403-versus-404 distinction below meaningful.
 *
 * ## What each status means
 *
 *   403 → refused for this role.                     The permission is real.
 *   404 → allowed for this role, row absent.         The permission is real, and so is the lookup.
 *   400/422 → allowed, body rejected.                Same conclusion.
 *   401 / 3xx → not authenticated.                   Correct for anonymous.
 *   200 → **DEFECT.** It answered for an id that cannot exist, so it never checked.
 *   5xx → **DEFECT.** It crashed instead of handling a missing row.
 *
 * A route where *every* admin role gets 404 has no role gate at all, which for anything under
 * invoices, plans or refunds is a finding rather than a pass.
 */
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import process from "node:process";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const outArg = process.argv.indexOf("--out");
const outPath = outArg > -1 ? process.argv[outArg + 1] : null;

const ADMIN_ROLES = ["super_admin", "support_agent", "billing_admin", "platform_config"];
const stamp = Date.now();
const temporaryAdmins = [];

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sign = (secret, claims) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(new TextEncoder().encode(secret));

async function adminCookie(role) {
  const { data, error } = await sb
    .from("admin_users")
    .select("id, role")
    .eq("role", role)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`cannot read admin_users for ${role}: ${error.message}`);

  let admin = data;
  if (!admin) {
    const { data: created, error: createError } = await sb
      .from("admin_users")
      .insert({
        email: `qa-sa-dynamic-${role}-${stamp}@insurvas.invalid`,
        name: `QA dynamic ${role}`,
        role,
        password_hash: "verification-only",
        totp_secret: "verification-only",
        is_active: true,
      })
      .select("id, role")
      .single();
    if (createError) throw new Error(`cannot create temporary ${role} admin: ${createError.message}`);
    admin = created;
    temporaryAdmins.push(created.id);
  }

  const token = await sign(process.env.ADMIN_SESSION_SECRET, {
    sub: admin.id,
    role: admin.role,
    stage: "authenticated",
  });
  return { role, cookie: `insurvas_admin_session=${token}` };
}

async function deactivateTemporaryAdmins() {
  if (!temporaryAdmins.length) return;
  const { error } = await sb.from("admin_users").update({ is_active: false }).in("id", temporaryAdmins);
  if (error) throw new Error(`cannot deactivate temporary admin fixtures: ${error.message}`);
  console.log(`temporary admin fixtures deactivated: ${temporaryAdmins.length}`);
}

/** Every dynamic admin route, with the HTTP methods its module actually exports. */
function dynamicRoutes(root, prefix) {
  const out = [];
  const walk = (dir, url) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, `${url}/${entry.name}`);
      else if (entry.name === "route.ts" && url.includes("[")) {
        const source = readFileSync(path, "utf8");
        const methods = ["GET", "POST", "PATCH", "PUT", "DELETE"].filter((m) =>
          new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b|export\\s+const\\s+${m}\\b`).test(source),
        );
        out.push({ route: url, file: path.replaceAll("\\", "/"), methods });
      }
    }
  };
  walk(root, prefix);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

/** A URL that is well formed and cannot match a row. */
const concreteUrl = (route) => route.replaceAll(/\[[^\]]+\]/g, () => randomUUID());

async function probe(url, method, cookie, timeoutMs = 15_000) {
  try {
    const response = await fetch(`${BASE}${url}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(method === "GET" ? {} : { "content-type": "application/json" }),
      },
      body: method === "GET" ? undefined : "{}",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.status;
  } catch (error) {
    return `ERR ${error.message.slice(0, 40)}`;
  }
}

const routes = dynamicRoutes(join(process.cwd(), "app", "api", "admin"), "/api/admin");

try {
  const sessions = [];
  for (const role of ADMIN_ROLES) sessions.push(await adminCookie(role));

  const report = {
    base: BASE,
    collected_at: new Date().toISOString(),
    method: "random UUID per dynamic segment, empty JSON body; authorization only, no mutation",
    routes: {},
  };

  // Warm every route first, one at a time, with a long timeout.
  //
  // Without this the matrix reports false findings: `next dev` compiles a route on its first
  // request, and firing five concurrent requests at an uncompiled route times all five out. That
  // read as "PATCH /api/admin/addons/[id] hangs for every role" on the first run of this script;
  // the route in fact answers in 213ms once compiled. The warm-up is anonymous and therefore
  // rejected before it touches anything.
  process.stdout.write(`warming ${routes.reduce((n, r) => n + r.methods.length, 0)} route handlers`);
  for (const { route, methods } of routes) {
    for (const method of methods) {
      await probe(concreteUrl(route), method, null, 90_000);
      process.stdout.write(".");
    }
  }
  process.stdout.write("\n");

  for (const { route, methods } of routes) {
    for (const method of methods) {
      const url = concreteUrl(route);
      const statuses = await Promise.all([
        probe(url, method, null),
        ...sessions.map((s) => probe(url, method, s.cookie)),
      ]);
      report.routes[`${method} ${route}`] = Object.fromEntries(
        ["anonymous", ...sessions.map((s) => s.role)].map((role, i) => [role, statuses[i]]),
      );
    }
  }

  const rows = Object.entries(report.routes).flatMap(([probeKey, byRole]) =>
    Object.entries(byRole).map(([role, status]) => ({ probe: probeKey, role, status })),
  );

  const isOk = (status) => typeof status === "number" && status >= 200 && status < 300;

  // A route on which no admin role is refused has no role gate. Not always wrong — SA-1's user
  // routes are deliberately open to more than one role — but it must be a decision, not an
  // accident, so every one is listed for review against the permission matrix.
  const ungated = Object.entries(report.routes)
    .filter(([, byRole]) => ADMIN_ROLES.every((role) => byRole[role] !== 403))
    .map(([probeKey, byRole]) => ({
      probe: probeKey,
      by_role: Object.fromEntries(ADMIN_ROLES.map((r) => [r, byRole[r]])),
    }));

  report.summary = {
    probes: Object.keys(report.routes).length,
    routes: routes.length,
    routes_without_exported_methods: routes.filter((r) => r.methods.length === 0).map((r) => r.route),
    // Each of these is a defect, not a status to interpret.
    server_errors: rows.filter((r) => typeof r.status === "number" && r.status >= 500),
    anonymous_accepted: rows.filter((r) => r.role === "anonymous" && isOk(r.status)),
    answered_for_absent_row: rows.filter((r) => r.role !== "anonymous" && isOk(r.status)),
    transport_errors: rows.filter((r) => typeof r.status === "string" && r.status.startsWith("ERR ")),
    ungated_probes: ungated,
    refusals_by_role: Object.fromEntries(
      ADMIN_ROLES.map((role) => [role, rows.filter((r) => r.role === role && r.status === 403).length]),
    ),
  };

  const json = JSON.stringify(report, null, 2);
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, json);
    console.log(`Wrote ${outPath}`);
  }

  console.log(`\nprobed ${report.summary.probes} method+route pairs across ${routes.length} dynamic routes`);
  console.log(`403 refusals by role: ${JSON.stringify(report.summary.refusals_by_role)}`);
  console.log(`server errors (5xx)          : ${report.summary.server_errors.length}`);
  console.log(`anonymous accepted (must be 0): ${report.summary.anonymous_accepted.length}`);
  console.log(`2xx for an absent row (must be 0): ${report.summary.answered_for_absent_row.length}`);
  console.log(`transport errors             : ${report.summary.transport_errors.length}`);
  console.log(`probes with no role refused  : ${report.summary.ungated_probes.length}`);

  for (const row of report.summary.server_errors) console.log(`  5xx  ${row.status}  ${row.role.padEnd(16)} ${row.probe}`);
  for (const row of report.summary.anonymous_accepted) console.log(`  LEAK ${row.status}  anonymous        ${row.probe}`);
  for (const row of report.summary.answered_for_absent_row) console.log(`  GHOST ${row.status} ${row.role.padEnd(16)} ${row.probe}`);
  for (const row of report.summary.transport_errors) console.log(`  ERR  ${row.role.padEnd(16)} ${row.probe} — ${row.status}`);

  if (!outPath) {
    console.log("\nfull matrix (403 = refused, 404 = allowed but absent):");
    for (const [probeKey, byRole] of Object.entries(report.routes)) {
      console.log(
        `  ${String(byRole.anonymous).padEnd(5)}` +
          ADMIN_ROLES.map((r) => String(byRole[r]).padEnd(6)).join("") +
          probeKey,
      );
    }
    console.log(`  anon ${ADMIN_ROLES.map((r) => r.slice(0, 5).padEnd(6)).join("")}(route)`);
  }

  // Fail closed: an all-ERR run must not be recorded as a healthy boundary.
  if (
    report.summary.server_errors.length ||
    report.summary.anonymous_accepted.length ||
    report.summary.answered_for_absent_row.length ||
    report.summary.transport_errors.length
  ) {
    process.exitCode = 1;
  }
} finally {
  try {
    await deactivateTemporaryAdmins();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
