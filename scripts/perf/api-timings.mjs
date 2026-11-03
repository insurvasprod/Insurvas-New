/**
 * Times one or more GET API routes as a demo member, N times each, against the production server.
 *
 *   node --env-file=.env.local scripts/perf/api-timings.mjs --as devin.okafor@qa-demo.insurvas.test --runs 5 /api/app/dialer/queue
 *
 * GET only; the session is signed in-process (as page-timings.mjs) and never printed.
 */
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import process from "node:process";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const base = opt("base", "http://localhost:3100");
const runs = Number(opt("runs", "5"));
const email = opt("as", "demo.agent@insurvas.test");
const tenantId = opt("tenant", "d6f3950f-0d88-4e66-869f-0de2ea6b396b");
const paths = args.filter((a, i) => a.startsWith("/") && !args[i - 1]?.startsWith("--"));

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await sb.from("tenant_users").select("user_id, users!inner(email, session_version)").eq("tenant_id", tenantId).eq("users.email", email).maybeSingle();
if (error || !data) throw new Error(`no member ${email}`);
const token = await new SignJWT({ sub: data.user_id, tenantId, sessionVersion: data.users.session_version ?? 0 })
  .setProtectedHeader({ alg: "HS256" }).setSubject(data.user_id).setIssuedAt().setExpirationTime("30m")
  .sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));

for (const path of paths) {
  const times = [];
  let status = null;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const res = await fetch(base + path, { headers: { cookie: `insurvas_tenant_session=${token}` } });
    await res.text();
    status = res.status;
    times.push(Math.round(performance.now() - t));
  }
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`${path} ${status} median ${sorted[Math.floor((sorted.length - 1) / 2)]} ms  [${times.join(", ")}]`);
}
