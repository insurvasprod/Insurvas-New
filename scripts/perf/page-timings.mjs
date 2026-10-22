/**
 * Page timing harness for the agent portal (app/app/(shell)/*).
 *
 * Measures every shell page for one or more demo members against a PRODUCTION server
 * (`next build` + `next start -p 3100`; never `next dev`, whose compile time swamps everything):
 *
 *   server  — time to first byte and to the end of the streamed HTML, by plain fetch with the
 *             session cookie and `redirect: manual` (a redirect shows as 3xx, not the target's time)
 *   browser — headless Chrome: time until the main content is drawn (no skeleton, nothing
 *             aria-busy, no page API still in flight), LCP, and the slowest /api call it waited on
 *
 * Read-only by construction: it only issues GETs, and the browser pass aborts every non-GET
 * request a page makes on load. Sessions are signed in-process (same claims as
 * scripts/mint-session.mjs) and never printed.
 *
 *   node --env-file=.env.local scripts/perf/page-timings.mjs --base http://localhost:3100 \
 *        --as owner=demo.agent@insurvas.test --as producer=devin.okafor@qa-demo.insurvas.test \
 *        --runs 3 --out docs/perf/baseline.json [--pages dashboard,leads] [--no-browser]
 *
 * Playwright is not a dependency of the app; point PLAYWRIGHT_CORE at any playwright-core install
 * (defaults to the npx cache copy on this machine). Chrome is the system install.
 */
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { createRequire } from "node:module";
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const many = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const base = opt("base", "http://localhost:3100");
const runs = Number(opt("runs", "3"));
const out = opt("out", null);
const withBrowser = !args.includes("--no-browser");
const tenantId = opt("tenant", "d6f3950f-0d88-4e66-869f-0de2ea6b396b"); // LA-1.25 Alert Demo
const members = (many("as").length ? many("as") : ["owner=demo.agent@insurvas.test", "producer=devin.okafor@qa-demo.insurvas.test"]).map((s) => {
  const [label, email] = s.split("=");
  return { label, email };
});

// Every static page under the shell. Dynamic segments ([id]) need ids and are left out.
const shellDir = join(process.cwd(), "app", "app", "(shell)");
const allPages = readdirSync(shellDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("("))
  .filter((d) => readdirSync(join(shellDir, d.name)).includes("page.tsx"))
  .map((d) => d.name);
const pages = opt("pages", null)?.split(",") ?? allPages;

// Background polls every page carries; they never count as "the page is waiting".
const POLLS = [/\/api\/app\/notifications/, /\/api\/app\/announcements/, /\/api\/app\/agent-alerts/, /\/api\/app\/presence/, /\/api\/app\/heartbeat/];

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function mint(email) {
  const { data, error } = await sb
    .from("tenant_users")
    .select("user_id, tenant_id, role, users!inner(email, session_version, status)")
    .eq("tenant_id", tenantId)
    .eq("users.email", email)
    .maybeSingle();
  if (error || !data) throw new Error(`no member ${email}: ${error?.message ?? "not found"}`);
  return new SignJWT({ sub: data.user_id, tenantId: data.tenant_id, sessionVersion: data.users.session_version ?? 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(data.user_id)
    .setIssuedAt()
    .setExpirationTime("120m")
    .sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));
}

const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

async function serverTiming(path, token) {
  const t0 = performance.now();
  const res = await fetch(base + path, { headers: { cookie: `insurvas_tenant_session=${token}` }, redirect: "manual" });
  const ttfb = performance.now() - t0;
  const body = await res.text();
  return { status: res.status, location: res.headers.get("location"), ttfb, total: performance.now() - t0, bytes: body.length };
}

async function browserTiming(context, path) {
  const page = await context.newPage();
  const api = new Map();
  let t0 = 0;
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/api/")) api.set(r, { url: u.replace(base, ""), start: performance.now() - t0, end: null, status: null });
  });
  page.on("requestfinished", async (r) => {
    const e = api.get(r);
    if (e) {
      e.end = performance.now() - t0;
      e.status = (await r.response().catch(() => null))?.status() ?? null;
    }
  });
  page.on("requestfailed", (r) => {
    const e = api.get(r);
    if (e) { e.end = performance.now() - t0; e.status = "failed"; }
  });
  // Never let a page write by being opened.
  await page.route("**/*", (route) => (route.request().method() === "GET" || route.request().method() === "HEAD" ? route.continue() : route.abort()));
  await page.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  t0 = performance.now();
  let status = null;
  let ready = null;
  let note = "";
  try {
    const resp = await page.goto(base + path, { waitUntil: "commit", timeout: 60000 });
    status = resp?.status() ?? null;
    const deadline = t0 + 45000;
    let quietSince = null;
    while (performance.now() < deadline) {
      const busy = await page.evaluate(() => {
        const main = document.querySelector("main");
        if (!main) return "no-main";
        const skel = [...main.querySelectorAll(".m-skel, [aria-busy='true'], [role='status'] .sr-only")].some((el) => el.getClientRects().length > 0);
        if (skel) return "skeleton";
        if (main.innerText.trim().length < 20) return "empty";
        return "";
      }).catch(() => "nav");
      const inflight = [...api.values()].filter((e) => e.end == null && !POLLS.some((p) => p.test(e.url)));
      const now = performance.now();
      if (!busy && inflight.length === 0) {
        quietSince ??= now;
        if (now - quietSince >= 300) { ready = quietSince - t0; break; }
      } else {
        quietSince = null;
        note = busy || `waiting ${inflight.map((e) => e.url.split("?")[0]).join(",")}`;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  } catch (err) {
    note = String(err.message).slice(0, 80);
  }
  const lcp = await page.evaluate(() => window.__lcp).catch(() => null);
  // Script the page loaded (decoded size, cached or not), so a heavy bundle shows whatever ran before it.
  const jsBytes = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.initiatorType === "script" || /\.js(\?|$)/.test(e.name)).reduce((sum, e) => sum + (e.decodedBodySize || 0), 0)).catch(() => 0);
  const finalUrl = page.url().replace(base, "");
  const calls = [...api.values()].filter((e) => !POLLS.some((p) => p.test(e.url)) && e.end != null && (ready == null || e.start <= ready));
  const slowest = calls.sort((a, b) => b.end - b.start - (a.end - a.start))[0] ?? null;
  await page.close();
  return {
    status, finalUrl, ready, lcp, note: ready == null ? note : "",
    apiCount: calls.length,
    jsKb: Math.round(jsBytes / 1024),
    slowestApi: slowest ? { url: slowest.url.split("?")[0], ms: slowest.end - slowest.start, status: slowest.status } : null,
    lastApiEnd: calls.length ? Math.max(...calls.map((e) => e.end)) : null,
  };
}

let chromium = null;
if (withBrowser) {
  const req = createRequire(import.meta.url);
  const pw = req(process.env.PLAYWRIGHT_CORE ?? "C:/Users/Victus/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core");
  chromium = await pw.chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
}

const results = [];
for (const m of members) {
  const token = await mint(m.email);
  let context = null;
  if (chromium) {
    context = await chromium.newContext({ viewport: { width: 1440, height: 900 } });
    const u = new URL(base);
    await context.addCookies([{ name: "insurvas_tenant_session", value: token, domain: u.hostname, path: "/", sameSite: "Lax" }]);
  }
  // Warm the server once per member (first request pays route module load).
  await serverTiming("/app/dashboard", token).catch(() => {});
  for (const p of pages) {
    const path = `/app/${p}`;
    const s = [];
    const b = [];
    for (let i = 0; i < runs; i++) {
      s.push(await serverTiming(path, token));
      if (context) b.push(await browserTiming(context, path));
    }
    const row = {
      member: m.label, page: p, status: s[0].status, location: s[0].location,
      ttfb: median(s.map((x) => x.ttfb)), html: median(s.map((x) => x.total)), kb: Math.round(s[0].bytes / 1024),
      ready: b.length ? median(b.map((x) => x.ready)) : null,
      lcp: b.length ? median(b.map((x) => x.lcp)) : null,
      apiCount: b.length ? median(b.map((x) => x.apiCount)) : null,
      jsKb: b.length ? median(b.map((x) => x.jsKb)) : null,
      slowestApi: b.length ? b.map((x) => x.slowestApi).filter(Boolean).sort((x, y) => y.ms - x.ms)[Math.floor(b.length / 2)] ?? null : null,
      finalUrl: b[0]?.finalUrl ?? null,
      note: b.map((x) => x.note).find(Boolean) ?? "",
    };
    results.push(row);
    const f = (x) => (x == null ? "—" : Math.round(x));
    console.log(`${m.label.padEnd(9)} ${p.padEnd(26)} ${String(row.status).padEnd(4)} ttfb ${f(row.ttfb)} html ${f(row.html)} ready ${f(row.ready)} lcp ${f(row.lcp)} api ${row.apiCount ?? "—"} js ${row.jsKb ?? "—"}kB slowest ${row.slowestApi ? `${row.slowestApi.url} ${f(row.slowestApi.ms)}` : "—"} ${row.note}`);
  }
  await context?.close();
}
await chromium?.close();

if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ base, runs, at: new Date().toISOString(), results }, null, 2));
  console.log(`wrote ${out}`);
}
