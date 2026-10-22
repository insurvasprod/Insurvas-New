/**
 * Before/after table from two page-timings.mjs runs.
 *
 *   node scripts/perf/compare.mjs docs/perf/baseline-2026-10-20.json docs/perf/after-2026-10-20.json [--top 40]
 *
 * One row per member × page, slowest-before first. "ready" is the browser's time until the main content
 * is drawn (or "—" when it never settled inside 45 s), "html" the server's time to finish the stream.
 */
import { readFileSync } from "node:fs";

const [beforePath, afterPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const topArg = process.argv.indexOf("--top");
const top = topArg === -1 ? Infinity : Number(process.argv[topArg + 1]);
const load = (p) => JSON.parse(readFileSync(p, "utf8")).results;
const before = load(beforePath);
const after = new Map(load(afterPath).map((r) => [`${r.member}|${r.page}`, r]));

const NEVER = 45_000; // a page that never settled counts as the harness's ceiling
const ms = (x) => (x == null ? "—" : `${Math.round(x).toLocaleString("en-US")}`);
const worst = (r) => Math.max(r.ready ?? NEVER, r.html ?? 0);
const delta = (b, a) => {
  if (b == null || a == null) return "";
  const pct = Math.round(((a - b) / b) * 100);
  return pct <= -10 ? `**${pct}%**` : `${pct > 0 ? "+" : ""}${pct}%`;
};

const rows = before
  .map((b) => ({ b, a: after.get(`${b.member}|${b.page}`) }))
  .sort((x, y) => worst(y.b) - worst(x.b))
  .slice(0, top);

console.log("| member | page | ready before | ready after | Δ | html before | html after | Δ | slowest API before → after |");
console.log("|---|---|--:|--:|--:|--:|--:|--:|---|");
for (const { b, a } of rows) {
  const api = (r) => (r?.slowestApi ? `${r.slowestApi.url.replace("/api/app/", "")} ${ms(r.slowestApi.ms)}` : "—");
  const readyB = b.ready ?? (b.note ? null : null);
  console.log(`| ${b.member} | ${b.page} | ${b.ready == null ? `never (${b.note})` : ms(readyB)} | ${a ? (a.ready == null ? `never (${a.note})` : ms(a.ready)) : "n/a"} | ${delta(b.ready ?? NEVER, a?.ready ?? (a ? NEVER : null))} | ${ms(b.html)} | ${ms(a?.html)} | ${delta(b.html, a?.html)} | ${api(b)} → ${api(a)} |`);
}

const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const paired = before.map((b) => [b, after.get(`${b.member}|${b.page}`)]).filter(([, a]) => a);
const med = (xs) => { const s = [...xs].sort((p, q) => p - q); return s[Math.floor((s.length - 1) / 2)]; };
console.log("");
console.log(`pages: ${paired.length}; median ready ${ms(med(paired.map(([b]) => b.ready ?? NEVER)))} → ${ms(med(paired.map(([, a]) => a.ready ?? NEVER)))} ms; ` +
  `median ttfb ${ms(med(paired.map(([b]) => b.ttfb)))} → ${ms(med(paired.map(([, a]) => a.ttfb)))} ms; ` +
  `total ready ${ms(sum(paired.map(([b]) => b.ready ?? NEVER)))} → ${ms(sum(paired.map(([, a]) => a.ready ?? NEVER)))} ms`);
