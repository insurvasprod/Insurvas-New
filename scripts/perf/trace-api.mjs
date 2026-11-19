/**
 * Hits each GET path once (after one warm-up) as a demo member and prints the PostgREST calls the server
 * logged during that request, in start order: the round trips that wait on each other show as a staircase.
 * Needs a production server started with PERF_TRACE=1 and its output written to a file.
 *
 *   node --env-file=.env.local scripts/perf/trace-api.mjs --log server.log --as demo.agent@insurvas.test /api/app/campaigns
 *
 * GET only; the session is signed in-process (as page-timings.mjs) and never printed. --cold skips the warm-up.
 */
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { readFileSync, statSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i === -1 ? f : args[i + 1]; };
const log = opt("log");
const base = opt("base", "http://localhost:3100");
const email = opt("as", "demo.agent@insurvas.test");
const tenantId = opt("tenant", "d6f3950f-0d88-4e66-869f-0de2ea6b396b");
const warm = !args.includes("--cold");
const paths = args.filter((a, i) => a.startsWith("/") && !args[i - 1]?.startsWith("--"));
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data } = await sb.from("tenant_users").select("user_id, users!inner(email, session_version)").eq("tenant_id", tenantId).eq("users.email", email).maybeSingle();
const token = await new SignJWT({ sub: data.user_id, tenantId, sessionVersion: data.users.session_version ?? 0 }).setProtectedHeader({ alg: "HS256" }).setSubject(data.user_id).setIssuedAt().setExpirationTime("30m").sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));
const get = async (p) => { const t = performance.now(); const r = await fetch(base + p, { headers: { cookie: `insurvas_tenant_session=${token}` } }); const body = await r.text(); return { ms: Math.round(performance.now() - t), status: r.status, bytes: body.length }; };
for (const p of paths) {
  if (warm) await get(p);
  await new Promise((r) => setTimeout(r, Number(opt("settle", "2500"))));
  const from = statSync(log).size;
  const res = await get(p);
  // The server's output reaches the file late when a shell redirect buffers it.
  await new Promise((r) => setTimeout(r, Number(opt("settle", "2500"))));
  const lines = readFileSync(log, "utf8").slice(from).split(/\r?\n/).filter((l) => l.includes("[perf-trace]"));
  const parsed = lines.map((l) => { const m = l.match(/\[perf-trace\] (\d+) \+(\d+)ms (\w+) (\d+) (.*)/); return m ? { start: +m[1], dur: +m[2], method: m[3], status: m[4], path: m[5] } : null; }).filter(Boolean);
  const t0 = Math.min(...parsed.map((x) => x.start));
  console.log(`\n=== ${p} ${res.status} ${res.ms} ms, ${res.bytes} B, ${parsed.length} db calls`);
  for (const x of parsed.sort((a, b) => a.start - b.start)) console.log(`  @${String(x.start - t0).padStart(5)} +${String(x.dur).padStart(5)} ${x.status} ${x.path}`);
}
