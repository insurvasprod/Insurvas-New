/**
 * Which script files a page's HTML asks for, and how big each is in the build (`.next/static`), as a demo member.
 * For finding what every cold page downloads before it can hydrate.
 *
 *   node --env-file=.env.local scripts/perf/page-scripts.mjs --base http://localhost:3110 --as demo.agent@insurvas.test leads dashboard
 *
 * GET only; the session is signed in-process (as page-timings.mjs) and never printed. With several pages it also
 * prints the files every one of them loads (the shell's own share).
 */
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { existsSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import process from "node:process";

const args = process.argv.slice(2);
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i === -1 ? f : args[i + 1]; };
const base = opt("base", "http://localhost:3100");
const email = opt("as", "demo.agent@insurvas.test");
const tenantId = opt("tenant", "d6f3950f-0d88-4e66-869f-0de2ea6b396b");
const pages = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data } = await sb.from("tenant_users").select("user_id, users!inner(email, session_version)").eq("tenant_id", tenantId).eq("users.email", email).maybeSingle();
if (!data) throw new Error(`no member ${email}`);
const token = await new SignJWT({ sub: data.user_id, tenantId, sessionVersion: data.users.session_version ?? 0 }).setProtectedHeader({ alg: "HS256" }).setSubject(data.user_id).setIssuedAt().setExpirationTime("30m").sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));

const size = (src) => {
  const file = `.next${src.replace(/^\/_next/, "").split("?")[0]}`;
  if (!existsSync(file)) return { raw: 0, gz: 0 };
  return { raw: statSync(file).size, gz: gzipSync(readFileSync(file)).length };
};
const kb = (n) => `${Math.round(n / 1024)}`;
const seen = [];
for (const page of pages) {
  const res = await fetch(`${base}/app/${page}`, { headers: { cookie: `insurvas_tenant_session=${token}` }, redirect: "manual" });
  const html = await res.text();
  const srcs = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[^"'\\\s]+\.js/g)].map((m) => m[0]))];
  const rows = srcs.map((src) => ({ src, ...size(src) })).sort((a, b) => b.raw - a.raw);
  const total = rows.reduce((t, r) => ({ raw: t.raw + r.raw, gz: t.gz + r.gz }), { raw: 0, gz: 0 });
  console.log(`\n=== /app/${page} ${res.status}: ${rows.length} scripts, ${kb(total.raw)} kB (${kb(total.gz)} kB gzip)`);
  for (const r of rows.slice(0, 12)) console.log(`  ${kb(r.raw).padStart(5)} kB ${kb(r.gz).padStart(4)} gz  ${r.src.replace("/_next/static/chunks/", "")}`);
  seen.push(new Set(srcs));
}
if (seen.length > 1) {
  const common = [...seen[0]].filter((src) => seen.every((s) => s.has(src)));
  const total = common.reduce((t, src) => t + size(src).raw, 0);
  console.log(`\nShared by every page: ${common.length} scripts, ${kb(total)} kB`);
}
