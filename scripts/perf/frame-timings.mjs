/**
 * Frame first, measured (UI-CONSISTENCY §7a): when a title first reaches the browser, when the page's own title line
 * does, and when its last block does.
 *   frame  the first streamed chunk that carries a title line (`data-page-title`, PageHeader's one h1). With an area
 *          `loading.tsx` this is the loading frame's title, drawn before the page itself has run.
 *   page   the chunk that carries the page's OWN title line (the last `data-page-title` in the stream): its real tabs
 *          and buttons. A page that awaits its data first has page ≈ html; a page that streams has page ≪ html.
 *   html   the end of the streamed HTML: when the last server block landed.
 * Client workspaces draw their data after hydration, so for them `frame` is the number that matters here, and
 * page-timings.mjs measures the rest.
 *
 *   node --env-file=.env.local scripts/perf/frame-timings.mjs --base http://localhost:3110 --runs 3 \
 *        [--as owner=demo.agent@insurvas.test --as producer=devin.okafor@qa-demo.insurvas.test] \
 *        [--out docs/perf/frame-before.json] [needs-you policies …]
 *
 * With no pages named it measures every static shell page (as page-timings.mjs finds them). GET only; sessions are
 * signed in-process (as page-timings.mjs) and never printed. A page that redirects or refuses shows its status.
 */
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i === -1 ? f : args[i + 1]; };
const many = (n) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []));
const base = opt("base", "http://localhost:3100");
const runs = Number(opt("runs", "3"));
const out = opt("out", null);
const tenantId = opt("tenant", "d6f3950f-0d88-4e66-869f-0de2ea6b396b");
const members = (many("as").length ? many("as") : ["owner=demo.agent@insurvas.test", "producer=devin.okafor@qa-demo.insurvas.test"]).map((s) => {
  const [label, email] = s.includes("=") ? s.split("=") : [s.split("@")[0], s];
  return { label, email };
});
const named = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const shellDir = join(process.cwd(), "app", "app", "(shell)");
const pages = named.length ? named : readdirSync(shellDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("(") && !d.name.startsWith("@"))
  .filter((d) => readdirSync(join(shellDir, d.name)).includes("page.tsx"))
  .map((d) => d.name);

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function mint(email) {
  const { data } = await sb.from("tenant_users").select("user_id, users!inner(email, session_version)").eq("tenant_id", tenantId).eq("users.email", email).maybeSingle();
  if (!data) throw new Error(`no member ${email}`);
  return new SignJWT({ sub: data.user_id, tenantId, sessionVersion: data.users.session_version ?? 0 }).setProtectedHeader({ alg: "HS256" }).setSubject(data.user_id).setIssuedAt().setExpirationTime("60m").sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));
}
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

async function once(token, page) {
  const t0 = performance.now();
  const res = await fetch(`${base}/app/${page}`, { headers: { cookie: `insurvas_tenant_session=${token}` }, redirect: "manual" });
  if (!res.body || res.status !== 200) { await res.text().catch(() => ""); return { status: res.status, frame: null, page: null, html: Math.round(performance.now() - t0) }; }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let frame = null;
  let own = null;
  let titles = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    const seen = html.split("data-page-title").length - 1;
    if (seen > titles) {
      titles = seen;
      const at = Math.round(performance.now() - t0);
      if (frame === null) frame = at;
      own = at;
    }
  }
  return { status: res.status, frame, page: own, html: Math.round(performance.now() - t0) };
}

const results = [];
for (const member of members) {
  const token = await mint(member.email);
  for (const page of pages) {
    await once(token, page); // warm the route's code once, so the numbers are the page's, not the first compile's
    const samples = [];
    for (let i = 0; i < runs; i++) samples.push(await once(token, page));
    const row = { member: member.label, page, status: samples[0].status, frame: median(samples.map((s) => s.frame)), ownTitle: median(samples.map((s) => s.page)), html: median(samples.map((s) => s.html)) };
    results.push(row);
    const f = (n) => (n == null ? "    —" : String(n).padStart(5));
    console.log(`${member.label.padEnd(9)} ${page.padEnd(26)} ${String(row.status).padEnd(4)} frame ${f(row.frame)} ms   own title ${f(row.ownTitle)} ms   html ${f(row.html)} ms${row.ownTitle != null && row.html - row.ownTitle < 80 && row.html > 600 ? "   (its own frame waits for the data)" : ""}`);
  }
}
const ok = results.filter((r) => r.frame != null);
console.log(`\n${ok.length} pages with a frame: median frame ${median(ok.map((r) => r.frame))} ms, own title ${median(ok.map((r) => r.ownTitle))} ms, html ${median(ok.map((r) => r.html))} ms; frame over 400 ms on ${ok.filter((r) => r.frame > 400).length}, own title over 400 ms on ${ok.filter((r) => r.ownTitle > 400).length}`);
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ base, runs, at: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
