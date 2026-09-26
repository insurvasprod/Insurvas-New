/**
 * The timing half of scripts/seed-loadtest.mjs (--measure). Minted sessions (scripts/mint-session.mjs)
 * against the dev server on :3000; each route is warmed first (dev compiles on the first hit), then
 * timed five times and reported as the median. The serve is timed twenty times.
 *
 * Prints one JSON document at the end (and writes it to --out=<file> when given).
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const DAY = 86400_000;

function mint(plane, email) {
  const out = execFileSync(process.execPath, ["--env-file=.env.local", "scripts/mint-session.mjs", plane, "--email", email, "--ttl", "120", "--js"], { encoding: "utf8" });
  const m = out.match(/document\.cookie=("(?:[^"\\]|\\.)*")/);
  if (!m) throw new Error(`could not mint a ${plane} session for ${email}: ${out.slice(0, 200)}`);
  return JSON.parse(m[1]).split(";")[0];
}

async function hit(method, path, cookie, body) {
  const headers = { cookie, origin: BASE };
  if (body !== undefined) headers["content-type"] = "application/json";
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: controller.signal });
    const text = await response.text();
    const ms = performance.now() - started;
    let json = null; try { json = JSON.parse(text); } catch { /* html or csv */ }
    return { ms, status: response.status, bytes: text.length, text, json, location: response.headers.get("location") };
  } finally { clearTimeout(timer); }
}

const median = (values) => { const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (values, p) => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const r0 = (n) => Math.round(n);

async function alive() {
  try { const r = await fetch(`${BASE}/app/login`, { redirect: "manual", signal: AbortSignal.timeout(20_000) }); return r.status < 500; } catch { return false; }
}

/** Warm `warm` times, then time `n` runs. `check` sees the last response and returns a note or throws. */
async function timeRoute(label, method, path, cookie, { warm = 2, n = 5, body, check } = {}) {
  if (!(await alive())) throw new Error(`STOP: :3000 is not answering (before ${label})`);
  for (let i = 0; i < warm; i += 1) await hit(method, path, cookie, body);
  const runs = []; let last = null;
  for (let i = 0; i < n; i += 1) { last = await hit(method, path, cookie, body); runs.push(last.ms); }
  const note = check ? check(last) : null;
  const result = { label, method, path, status: last.status, bytes: last.bytes, runs_ms: runs.map(r0), median_ms: r0(median(runs)), note };
  console.log(`  ${label.padEnd(44)} ${String(result.status).padEnd(4)} median ${String(result.median_ms).padStart(6)} ms  [${result.runs_ms.join(", ")}]${note ? `  ${note}` : ""}`);
  return result;
}

export async function measure({ db, ID, EMAIL, COUNTS, uid, setTransfers, only, out }) {
  const want = (key) => !only || only.split(",").includes(key);
  const results = { at: new Date().toISOString(), tenant: ID.load, emptyTenant: ID.empty, lines: {} };
  const owner = mint("tenant", EMAIL.owner);
  const today = new Date().toISOString().slice(0, 10);
  const from30 = new Date(Date.now() - 31 * DAY).toISOString().slice(0, 10);
  console.log("Timing against :3000 (warm ×2, then median of 5)\n");

  // ── LA-1.10-10: the inbox with 500 unclaimed ──────────────────────────────
  if (want("inbox")) {
    await setTransfers(true);
    try {
      const api = await timeRoute("LA-1.10-10 GET /api/app/inbound", "GET", "/api/app/inbound", owner, {
        check: (r) => { const items = r.json?.items ?? []; return `items ${items.length}, from one partner: ${new Set(items.map((i) => i.partnerName)).size === 1}, truncated ${r.json?.truncated}, waiting ${r.json?.summary?.waiting}`; },
      });
      const page = await timeRoute("LA-1.10-10 page /app/inbound", "GET", "/app/inbound", owner);
      results.lines["LA-1.10-10"] = { target_ms: 1000, api, page };
    } finally { await setTransfers(false); }
  }

  // ── LA-1.13-10: deal flow at 10,000 rows ──────────────────────────────────
  if (want("dealflow")) {
    const q = `/api/app/deal-flow?from=${from30}&to=${today}`;
    const api = await timeRoute("LA-1.13-10 GET deal-flow (30 days)", "GET", q, owner, { check: (r) => `total ${r.json?.total}, rows ${r.json?.rows?.length}, partner groups ${r.json?.summary?.length}` });
    const csv = await timeRoute("LA-1.13-10 deal-flow CSV (30 days)", "GET", `${q}&format=csv`, owner, { warm: 1, check: (r) => `${r.text.split("\r\n").filter(Boolean).length - 1} data lines` });
    const page = await timeRoute("LA-1.13-10 page /app/deal-flow", "GET", "/app/deal-flow", owner);
    results.lines["LA-1.13-10"] = { target_ms: 2000, api, csv, page };
  }

  // ── LA-1.17-12: the partner's own pipeline at 5,000 leads ─────────────────
  if (want("partner")) {
    const partner = mint("partner", EMAIL.partner);
    const api = await timeRoute("LA-1.17-12 GET /api/partner/leads/pipeline", "GET", "/api/partner/leads/pipeline", partner, { check: (r) => `total ${r.json?.total}, rows ${r.json?.rows?.length}, nextOffset ${r.json?.nextOffset}` });
    const next = await timeRoute("LA-1.17-12 pipeline page 2 (offset 250)", "GET", "/api/partner/leads/pipeline?limit=250&offset=250", partner, { warm: 1, check: (r) => `rows ${r.json?.rows?.length}` });
    const page = await timeRoute("LA-1.17-12 page /partner/pipeline", "GET", "/partner/pipeline", partner);
    results.lines["LA-1.17-12"] = { target_ms: 2000, api, next, page };
  }

  // ── LA-1.24-9: the pre-flight at 20,000 contacts ──────────────────────────
  if (want("preflight")) {
    const leadId = uid("lead", "contacts:777");
    const api = await timeRoute("LA-1.24-9 POST /api/app/leads/[id]/preflight", "POST", `/api/app/leads/${leadId}/preflight`, owner, { check: (r) => `status ${r.json?.result?.status}, matches ${r.json?.result?.matches?.length}${r.json?.error ? `, error ${r.json.error}` : ""}` });
    const lead = (await db.from("agent_leads").select("values").eq("id", leadId).single()).data;
    const args = { p_tenant_id: ID.load, p_full_name: lead.values.full_name, p_dob: lead.values.date_of_birth, p_phone_digits: lead.values.phone, p_address_search: null, p_exclude_lead_id: leadId, p_limit: 20 };
    await db.rpc("find_existing_customer_preflight", args);
    const rpcRuns = [];
    let rpcLast = null;
    for (let i = 0; i < 5; i += 1) { const t = performance.now(); rpcLast = await db.rpc("find_existing_customer_preflight", args); rpcRuns.push(performance.now() - t); }
    const rpc = { label: "find_existing_customer_preflight (service RPC)", runs_ms: rpcRuns.map(r0), median_ms: r0(median(rpcRuns)), note: rpcLast.error ? rpcLast.error.message : `${rpcLast.data?.length} matches` };
    console.log(`  ${rpc.label.padEnd(44)}      median ${String(rpc.median_ms).padStart(6)} ms  [${rpc.runs_ms.join(", ")}]  ${rpc.note}`);
    const counts = {};
    for (const table of ["contacts", "agent_leads"]) counts[table] = (await db.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", ID.load)).count;
    results.lines["LA-1.24-9"] = { target_ms: 500, api, rpc, tenantCounts: counts };
  }

  // ── LA-1.15-7: a brand-new tenant renders ─────────────────────────────────
  if (want("empty")) {
    const empty = mint("tenant", EMAIL.emptyOwner);
    const errorText = /Application error|Something went wrong|Unhandled Runtime Error|Could not load/i;
    const pageCheck = (r) => `${r.location ? `redirect ${r.location}, ` : ""}${errorText.test(r.text) ? "ERROR TEXT IN PAGE" : "no error text"}`;
    const floor = await timeRoute("LA-1.15-7 page /app/floor (empty tenant)", "GET", "/app/floor", empty, { check: pageCheck });
    const floorApi = await timeRoute("LA-1.15-7 GET /api/app/agent-floor", "GET", "/api/app/agent-floor", empty, { check: (r) => `waiting ${r.json?.waiting?.length}, onCalls ${r.json?.onCalls?.length}, members ${r.json?.members?.length}${r.json?.error ? `, error ${r.json.error}` : ""}` });
    const dashboard = await timeRoute("LA-1.15-7 page /app/dashboard (empty tenant)", "GET", "/app/dashboard", empty, { check: pageCheck });
    // A brand-new owner who has not accepted the current legal documents is sent here first (SA-5.4).
    const terms = await timeRoute("LA-1.15-7 page /app/accept-terms", "GET", "/app/accept-terms", empty, { check: pageCheck });
    results.lines["LA-1.15-7"] = { floor, floorApi, dashboard, terms };
  }

  // ── LA-2.21-4: the activity CSV over 100,000 rows ─────────────────────────
  if (want("activity")) {
    const csv = await timeRoute("LA-2.21-4 GET /api/app/activity?format=csv", "GET", "/api/app/activity?format=csv", owner, { warm: 1, check: (r) => r.status === 200 ? `${r.text.split(/\r?\n/).filter(Boolean).length - 1} data lines, ${(r.bytes / 1e6).toFixed(1)} MB` : `error ${r.json?.error ?? r.text.slice(0, 200)}` });
    const page1 = await timeRoute("LA-2.21-4 GET /api/app/activity (page 1 of 50)", "GET", "/api/app/activity?page=1&page_size=50", owner, { check: (r) => `total ${r.json?.total}, rows ${r.json?.rows?.length}${r.json?.error ? `, error ${r.json.error}` : ""}` });
    const pageDeep = await timeRoute("LA-2.21-4 GET /api/app/activity (page 1000)", "GET", "/api/app/activity?page=1000&page_size=50", owner, { warm: 1, check: (r) => `rows ${r.json?.rows?.length}` });
    results.lines["LA-2.21-4"] = { target_ms: 2000, csv, page1, pageDeep };
  }

  // ── LA-2.8-7: the serve at 100,000 eligible (for Design 3) ────────────────
  if (want("serve")) {
    const eligibleBefore = (await db.from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", ID.load).eq("status", "unclaimed").is("partner_id", null)).count;
    const serveRun = async (label) => {
      if (!(await alive())) throw new Error(`STOP: :3000 is not answering (before ${label})`);
      for (let i = 0; i < 2; i += 1) await hit("POST", "/api/app/dialer/next", owner, {});
      const runs = []; const tiers = {}; let empties = 0; let last = null;
      for (let i = 0; i < 20; i += 1) {
        last = await hit("POST", "/api/app/dialer/next", owner, {});
        runs.push(last.ms);
        if (last.json?.served) tiers[last.json.served.tier_name ?? last.json.served.tier ?? "?"] = (tiers[last.json.served.tier_name ?? last.json.served.tier ?? "?"] ?? 0) + 1; else empties += 1;
      }
      const out = { label, status: last.status, runs_ms: runs.map(r0), median_ms: r0(median(runs)), p90_ms: r0(pct(runs, 90)), min_ms: r0(Math.min(...runs)), max_ms: r0(Math.max(...runs)), served_by_tier: tiers, empty: empties, error: last.json?.error ?? null };
      console.log(`  ${label.padEnd(44)} ${String(out.status).padEnd(4)} median ${String(out.median_ms).padStart(6)} ms  p90 ${out.p90_ms}  [${out.runs_ms.join(", ")}]  ${JSON.stringify(tiers)} empty ${empties}${out.error ? ` error ${out.error}` : ""}`);
      return out;
    };
    const prior = (await db.from("tenant_scoring_settings").select("*").eq("tenant_id", ID.load).maybeSingle()).data;
    await db.from("tenant_scoring_settings").delete().eq("tenant_id", ID.load);
    const naive = await serveRun("LA-2.8-7 POST /api/app/dialer/next (scoring off)");
    // Direct RPC, no route around it: what the database alone costs.
    const rpcRuns = [];
    const ownerId = (await db.from("users").select("id").eq("email", EMAIL.owner).single()).data.id;
    for (let i = 0; i < 5; i += 1) { const t = performance.now(); const r = await db.rpc("serve_next_lead", { p_tenant_id: ID.load, p_agent_user_id: ownerId }); rpcRuns.push(performance.now() - t); if (r.error) { console.log(`  serve RPC error ${r.error.message}`); break; } }
    const rpc = { label: "serve_next_lead (service RPC, scoring off)", runs_ms: rpcRuns.map(r0), median_ms: r0(median(rpcRuns)) };
    console.log(`  ${rpc.label.padEnd(44)}      median ${String(rpc.median_ms).padStart(6)} ms  [${rpc.runs_ms.join(", ")}]`);
    // The demo tenant's setting (scoring on, 10% holdout), which is the scored path.
    await db.from("tenant_scoring_settings").upsert({ tenant_id: ID.load, enabled: true, holdout_pct: 10, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
    const scored = await serveRun("LA-2.8-7 POST /api/app/dialer/next (scoring on, 10%)");
    await db.from("tenant_scoring_settings").delete().eq("tenant_id", ID.load);
    if (prior) await db.from("tenant_scoring_settings").insert(prior);
    const eligibleAfter = (await db.from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", ID.load).eq("status", "unclaimed").is("partner_id", null)).count;
    results.lines["LA-2.8-7"] = { target_ms: 200, eligibleBefore, eligibleAfter, naive, rpc, scored };
  }

  console.log("\n" + JSON.stringify(results, null, 2));
  if (out) writeFileSync(out, JSON.stringify(results, null, 2));
}
