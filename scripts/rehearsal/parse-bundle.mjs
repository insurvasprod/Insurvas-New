// Parse-checks a generated bundle AS ONE FILE, in a READ-ONLY transaction (the database refuses any write),
// with every transaction-control statement removed first. A syntax error (42601) is the only failure that a
// bad join between files produces; permission / read-only / not-yet-created errors mean the statement parsed.
// node --env-file=.env.local parse-bundle.mjs <bundle.sql> <expected files>
import fs from "node:fs";
import { createRequire } from "node:module";
const R = process.cwd(); // run from the repository root
const pg = createRequire(`${R}/package.json`)("pg");
const [file, expected] = process.argv.slice(2);
const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const split = (t) => {
  const out = []; let start = 0; let i = 0;
  while (i < t.length) {
    if (t.startsWith("--", i)) { const e = t.indexOf("\n", i); i = e < 0 ? t.length : e + 1; continue; }
    if (t[i] === "'") { i++; while (i < t.length) { if (t[i] === "'" && t[i + 1] === "'") { i += 2; continue; } if (t[i] === "'") break; i++; } i++; continue; }
    if (t[i] === "$") { const m = /^\$[A-Za-z_0-9]*\$/.exec(t.slice(i)); if (m) { const e = t.indexOf(m[0], i + m[0].length); i = e < 0 ? t.length : e + m[0].length; continue; } }
    if (t[i] === ";") { out.push(t.slice(start, i + 1)); start = i + 1; }
    i++;
  }
  if (t.slice(start).trim()) out.push(t.slice(start));
  // statements go to the server exactly as written: a "--" inside a string literal is not a comment
  return out.map((s) => s.trim()).filter((s) => bare(s));
};
// a statement with its LEADING comment lines removed, for classifying it only
const bare = (s) => s.replace(/^(\s*--[^\n]*(\n|$))+/g, "").trim();
const all = split(text);
const isCtl = (s) => /^(begin|start\s+transaction|commit|end|rollback|savepoint|release|abort)\b[^;]*;?$/i.test(bare(s));
const begins = all.filter((s) => /^begin\s*;$/i.test(bare(s))).length;
const commits = all.filter((s) => /^commit\s*;$/i.test(bare(s))).length;
console.log(`${all.length} statements; begin ${begins}, commit ${commits} (expected ${expected} each)`);
if (begins !== Number(expected) || commits !== Number(expected) || all.filter(isCtl).length !== begins + commits) {
  console.log("TRANSACTION CONTROL DOES NOT MATCH — stop"); process.exit(1);
}
const c = new pg.Client({ connectionString: process.env.TENANT_DB_URL });
await c.connect();
await c.query("begin read only");
const codes = new Map(); const syntax = [];
try {
  for (const s of all.filter((x) => !isCtl(x))) {
    await c.query("savepoint s");
    try { await c.query(s); codes.set("ok", (codes.get("ok") ?? 0) + 1); }
    catch (e) {
      codes.set(e.code, (codes.get(e.code) ?? 0) + 1);
      if (e.code === "42601") syntax.push(`${e.message} :: ${s.replace(/\s+/g, " ").slice(0, 200)}`);
    }
    await c.query("rollback to savepoint s");
  }
} finally { await c.query("rollback"); await c.end(); }
console.log("outcomes:", JSON.stringify(Object.fromEntries(codes)));
console.log(syntax.length ? `SYNTAX ERRORS (${syntax.length}):\n  ${syntax.join("\n  ")}` : "no syntax errors — every statement parsed");
process.exitCode = syntax.length ? 1 : 0;
