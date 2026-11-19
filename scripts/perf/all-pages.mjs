/**
 * Every page of the service, timed (owner 2026-11-17: "make every one of the 284 pages open under 1 second").
 *
 * page-timings.mjs covers the agency app's top-level pages. This covers every `page.tsx` under `app/`: the agency
 * app (owner of the demo agency), the admin console, the partner portal and the public pages, record pages included.
 * A record page's address comes from the page above it: the harness opens the parent and takes the first link that
 * fits the pattern, so it needs no knowledge of ids. A page with no such link is reported as "no sample".
 *
 * Two timings per page, both to "content": no skeleton, nothing aria-busy, no page API in flight, for 300ms:
 *   open — clicked to from the page before, inside the app (the router's push), as people open pages
 *   cold — a fresh tab loading the address, script and all
 *
 * Read-only by construction: GET and HEAD only, every other request a page makes is aborted. Against a PRODUCTION
 * server only (`next build`, `next start -p 3100`).
 *
 *   node --env-file=.env.local scripts/perf/all-pages.mjs --base http://localhost:3100 --out docs/perf/x.json
 *        [--only /app/leads,/admin] [--no-cold] [--no-warm] [--plane app|admin|partner|public]
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i === -1 ? fallback : args[i + 1]; };
const base = opt("base", "http://localhost:3100");
const out = opt("out", null);
const only = opt("only", null)?.split(",") ?? null;
const planeOnly = opt("plane", null);
const withCold = !args.includes("--no-cold");
// --no-warm: the browser says "data saver", so the app's load-ahead (warm-app.tsx, warm-page.tsx) stays off. To compare.
const noWarm = args.includes("--no-warm");
const BUDGET = Number(opt("budget", "1000"));

/* ── Every page.tsx, as an address pattern ─────────────────────────────────────────────────────────────────────── */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      // Parallel slots (@sheet) and intercepting routes ((.)x) only draw over another page.
      if (name.startsWith("@") || /^\(\.+\)/.test(name)) continue;
      walk(full, out);
    } else if (name === "page.tsx") out.push(dir);
  }
  return out;
}
const appDir = join(process.cwd(), "app");
export const routes = walk(appDir).map((dir) => {
  const parts = dir.slice(appDir.length).split(/[\\/]/).filter(Boolean).filter((p) => !/^\(.*\)$/.test(p));
  const pattern = `/${parts.join("/")}`;
  const plane = pattern.startsWith("/app") ? "app" : pattern.startsWith("/admin") ? "admin" : pattern.startsWith("/partner") ? "partner" : "public";
  return { pattern, plane, dynamic: parts.some((p) => p.startsWith("[")) };
}).sort((a, b) => a.pattern.localeCompare(b.pattern));

/* ── Sessions, one per plane (scripts/mint-session.mjs signs them; nothing is printed) ───────────────────────────── */
function mint(plane, extra) {
  const text = execFileSync(process.execPath, ["--env-file=.env.local", "scripts/mint-session.mjs", plane, ...extra, "--ttl", "180"], { encoding: "utf8" });
  const line = text.trim().split(/\r?\n/).filter((l) => !l.startsWith("#")).pop();
  const eq = line.indexOf("=");
  return { name: line.slice(0, eq), value: line.slice(eq + 1).split(";")[0] };
}
const SESSIONS = {
  app: () => mint("tenant", ["--email", opt("owner", "demo.agent@insurvas.test")]),
  admin: () => mint("admin", ["--email", opt("admin", "qa.design@insurvas.test")]),
  partner: () => mint("partner", ["--role", "partner_admin"]),
  public: () => null,
};
const HUB = { app: "/app/dashboard", admin: "/admin", partner: "/partner", public: "/" };

/* ── The browser ─────────────────────────────────────────────────────────────────────────────────────────────── */
const req = createRequire(import.meta.url);
const pw = req(process.env.PLAYWRIGHT_CORE ?? "C:/Users/Victus/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core");
const chromium = await pw.chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });

// Background polls and the shell's own widgets never count as "the page is waiting" (page-timings.mjs).
const POLLS = [/\/api\/app\/notifications/, /\/api\/app\/announcements/, /\/api\/app\/agent-alerts/, /\/api\/app\/presence/, /\/api\/app\/heartbeat/, /\/api\/app\/inbound\/waiting/, /\/api\/app\/auth\/workspaces/, /\/api\/partner\/notifications/, /\/api\/admin\/notifications/];

async function tab(context) {
  const page = await context.newPage();
  const api = new Map();
  // Reads made ahead of a click (lib/client/resource-cache.ts tags them) are not this page waiting.
  page.on("request", (r) => { if (r.url().includes("/api/") && !r.headers()["x-insurvas-warm"]) api.set(r, { url: r.url().replace(base, ""), start: performance.now(), end: null }); });
  page.on("requestfinished", (r) => { const e = api.get(r); if (e) e.end = performance.now(); });
  page.on("requestfailed", (r) => { const e = api.get(r); if (e) e.end = performance.now(); });
  await page.route("**/*", (route) => (["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort()));
  return { page, api };
}

/** Until the content is drawn and quiet for 300ms; the time it first went quiet, from t0. */
async function settle({ page, api }, t0, expectPath) {
  const deadline = t0 + 30000;
  let quietSince = null;
  let note = "";
  while (performance.now() < deadline) {
    // Until the address changes (a redirecting page never reaches its own, so after 2s any address will do).
    const want = expectPath && performance.now() - t0 < 2000 ? expectPath : null;
    const busy = await page.evaluate((want) => {
      if (want && location.pathname !== want) return "navigating";
      const main = document.querySelector("main") ?? document.body;
      if (!main) return "no-main";
      const skel = [...main.querySelectorAll(".m-skel, [aria-busy='true'], [role='status'] .sr-only")].some((el) => el.getClientRects().length > 0);
      if (skel) return "skeleton";
      if (main.innerText.trim().length < 20) return "empty";
      return "";
    }, want).catch(() => "nav");
    const inflight = [...api.values()].filter((e) => e.end == null && !POLLS.some((p) => p.test(e.url)));
    const now = performance.now();
    if (!busy && inflight.length === 0) {
      quietSince ??= now;
      if (now - quietSince >= 300) return { ms: quietSince - t0, note: "" };
    } else {
      quietSince = null;
      note = busy || `waiting ${inflight.map((e) => e.url.split("?")[0]).slice(0, 2).join(",")}`;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return { ms: null, note: note || "timeout" };
}

/** A record page's address: the first link on the nearest parent page that fits the pattern. */
async function sampleFor(t, pattern) {
  const re = new RegExp(`^${pattern.replace(/\[\.\.\.[^\]]+\]/g, ".+").replace(/\[[^\]]+\]/g, "[^/?#]+")}(?:[?#].*)?$`);
  let parent = pattern;
  for (let i = 0; i < 4; i++) {
    parent = parent.replace(/\/[^/]+$/, "") || "/";
    const staticParent = parent.replace(/\/\[[^\]]+\].*$/, "");
    if (staticParent.includes("[")) continue;
    try {
      await t.page.goto(base + staticParent, { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(t, performance.now(), null);
      const hrefs = await t.page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")));
      const hit = hrefs.find((h) => h && re.test(h.split("#")[0]));
      if (hit) return hit;
    } catch { /* try the next parent up */ }
    if (staticParent === "/" || staticParent.split("/").length <= 2) break;
  }
  return null;
}

const results = [];
const planes = ["app", "admin", "partner", "public"].filter((p) => !planeOnly || p === planeOnly);
for (const plane of planes) {
  const list = routes.filter((r) => r.plane === plane && (!only || only.some((o) => r.pattern.startsWith(o))));
  if (!list.length) continue;
  const session = SESSIONS[plane]();
  const context = await chromium.newContext({ viewport: { width: 1440, height: 900 } });
  if (noWarm) await context.addInitScript(() => { Object.defineProperty(navigator, "connection", { value: { saveData: true, effectiveType: "4g" }, configurable: true }); });
  if (session) await context.addCookies([{ name: session.name, value: session.value, domain: new URL(base).hostname, path: "/", sameSite: "Lax" }]);
  const finder = await tab(context);
  const nav = await tab(context);
  // Load the hub once: the app's script is in, then every page is opened from the one before it.
  await nav.page.goto(base + HUB[plane], { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await settle(nav, performance.now(), null);
  await nav.page.waitForTimeout(3000); // the shell's own load-ahead runs while idle, as for a person who just signed in
  for (const route of list) {
    const url = route.dynamic ? await sampleFor(finder, route.pattern) : route.pattern;
    const row = { plane, pattern: route.pattern, url, open: null, cold: null, status: null, finalPath: null, note: "" };
    if (!url) { row.note = "no sample"; results.push(row); console.log(`${plane.padEnd(7)} ${route.pattern.padEnd(48)} no sample`); continue; }
    const path = url.split("?")[0];
    // open: the router's push, from wherever the last page left the tab.
    try {
      const pushed = await nav.page.evaluate((u) => { if (!window.next?.router) return false; window.next.router.push(u); return true; }, url);
      const t0 = performance.now();
      if (!pushed) { await nav.page.goto(base + url, { waitUntil: "commit", timeout: 30000 }); row.note = "no router; loaded"; }
      const s = await settle(nav, t0, path);
      row.open = s.ms; if (s.note) row.note = `open: ${s.note}`;
      // The page's own API calls during the open, slowest first (polls left out): where its time went.
      row.apis = [...nav.api.values()].filter((e) => e.start >= t0 && !POLLS.some((p) => p.test(e.url))).map((e) => ({ url: e.url.split("?")[0], q: e.url.includes("?") ? e.url.slice(e.url.indexOf("?")) .slice(0, 80) : "", at: Math.round(e.start - t0), ms: e.end == null ? null : Math.round(e.end - e.start) })).sort((a, b) => (b.ms ?? 1e9) - (a.ms ?? 1e9)).slice(0, 12);
      nav.api.clear();
      row.finalPath = await nav.page.evaluate(() => location.pathname).catch(() => null);
    } catch (e) { row.note = `open: ${String(e.message).slice(0, 60)}`; }
    if (withCold) {
      const cold = await tab(context);
      const t0 = performance.now();
      try {
        const resp = await cold.page.goto(base + url, { waitUntil: "commit", timeout: 30000 });
        row.status = resp?.status() ?? null;
        const s = await settle(cold, t0, null);
        row.cold = s.ms; if (s.note && !row.note) row.note = `cold: ${s.note}`;
      } catch (e) { if (!row.note) row.note = `cold: ${String(e.message).slice(0, 60)}`; }
      await cold.page.close();
    }
    results.push(row);
    const f = (x) => (x == null ? "  —  " : String(Math.round(x)).padStart(5));
    const flag = (row.open ?? Infinity) > BUDGET ? " OVER" : "";
    console.log(`${plane.padEnd(7)} ${route.pattern.padEnd(48)} open ${f(row.open)} cold ${f(row.cold)}${flag} ${row.finalPath && row.finalPath !== path ? `→ ${row.finalPath}` : ""} ${row.note}`);
  }
  await context.close();
}
await chromium.close();

const timed = results.filter((r) => r.open != null);
const over = timed.filter((r) => r.open > BUDGET);
console.log(`\n${results.length} pages · ${timed.length} timed · ${over.length} over ${BUDGET}ms to open · ${results.filter((r) => r.note === "no sample").length} with no sample`);
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ base, at: new Date().toISOString(), budget: BUDGET, results }, null, 2));
  console.log(`wrote ${out}`);
}
void existsSync;
