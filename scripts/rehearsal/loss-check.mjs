// For every function a pending file REPLACES wholesale (create or replace … where it already exists live):
// the lines of the LIVE body that the file's body does not contain — what applying the file would remove.
// Read-only. node --env-file=.env.local loss-check.mjs <list file>
import fs from "node:fs";
import { createRequire } from "node:module";
const R = process.cwd(); // run from the repository root
const DIR = `${R}/supabase/migrations`;
const pg = createRequire(`${R}/package.json`)("pg");
const versions = fs.readFileSync(process.argv[2], "utf8").split(/\s+/).filter(Boolean);
const all = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const norm = (s) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
// every migration file, normalised line by line and joined, so a live line can be looked up in any of them
const corpus = all.map((f) => [f, fs.readFileSync(`${DIR}/${f}`, "utf8").replace(/\r\n/g, "\n").split("\n").map(norm).join("\n")]);
const c = new pg.Client({ connectionString: process.env.TENANT_DB_URL });
await c.connect();
await c.query("begin read only");
for (const v of versions) {
  const file = all.find((f) => f.startsWith(v));
  const text = fs.readFileSync(`${DIR}/${file}`, "utf8").replace(/\r\n/g, "\n");
  const defs = new Map();
  for (const m of text.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:(public|private)\.)?"?([a-z_0-9]+)"?\s*\(([\s\S]*?)\)\s*returns[\s\S]*?as\s+(\$[a-z_]*\$)([\s\S]*?)\4/gi)) defs.set(`${(m[1] ?? "public").toLowerCase()}.${m[2].toLowerCase()}`, m[5]);
  const lines = [];
  for (const [qn, body] of defs) {
    const [ns, fn] = qn.split(".");
    const live = (await c.query("select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.proname = $2", [ns, fn])).rows;
    if (!live.length) continue; // new function: nothing to lose
    const fileBody = norm(body);
    for (const { prosrc } of live) {
      const lost = prosrc.replace(/\r\n/g, "\n").split("\n").map(norm).filter((l) => l.length > 18 && !fileBody.includes(l));
      // a lost line that some OTHER migration file contains is old code the file replaces on purpose;
      // one that no migration file contains was written by hand in the SQL editor — the file would erase it
      const hand = lost.filter((l) => !corpus.some(([f, t]) => f < file && t.includes(l)));
      if (lost.length) lines.push(`  ${qn}: ${lost.length} live line(s) replaced${hand.length ? `; ${hand.length} of them are in NO migration file (hand-made):\n${hand.slice(0, 6).map((l) => `      ! ${l.slice(0, 160)}`).join("\n")}` : " — all of them come from earlier migration files"}`);
    }
  }
  console.log(`${lines.length ? "LOSES " : "ok    "} ${file}${lines.length ? `\n${lines.join("\n")}` : ""}`);
}
await c.query("rollback");
await c.end();
