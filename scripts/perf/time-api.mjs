// Times app API routes on the running server with a minted demo session, each N times in a row.
//   node --env-file=.env.local scripts/perf/time-api.mjs [--base http://localhost:3100] [--n 5] [--email demo.agent@insurvas.test] /api/app/setup /api/app/accounting/steps ...
// Prints each call's ms and the median. Reads only (GET).
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const base = opt("--base", "http://localhost:3100");
const n = Number(opt("--n", "5"));
const email = opt("--email", "demo.agent@insurvas.test");
const out = execFileSync(process.execPath, ["--env-file=.env.local", "scripts/mint-session.mjs", "tenant", "--email", email, "--ttl", "30"], { encoding: "utf8" });
const cookie = out.split(/\r?\n/).find((line) => line.startsWith("insurvas_tenant_session="));
if (!cookie) throw new Error("could not mint a session");

for (const path of args) {
  const times = [];
  let status = 0;
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    const response = await fetch(base + path, { headers: { cookie } });
    await response.arrayBuffer();
    status = response.status;
    times.push(Math.round(performance.now() - t));
  }
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`${path.padEnd(48)} ${String(status).padEnd(4)} median ${String(sorted[Math.floor(n / 2)]).padStart(5)}  [${times.join(", ")}]`);
}
