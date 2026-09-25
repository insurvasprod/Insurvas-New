/**
 * Which migrations since a given version are live in the database (default 20260923).
 *
 * The SQL editor does not write migration history, so "applied" is read from the catalog: every
 * `create [or replace] function public.X` in a file must exist AND its live body must contain a
 * distinctive line of the file's body; every `create table if not exists`, `add column if not exists`
 * and view must exist. Catalog reads only — no SET, no DDL, no writes (TENANT_DB_URL is the
 * transaction-mode pooler). Files that change only constraints or run DO blocks report "??"; check
 * those by hand.
 *
 *   node --env-file=.env.local scripts/verify-applied-migrations.mjs [fromVersion]
 */
import fs from "node:fs";
import pg from "pg";

const DIR = "supabase/migrations";
const files = fs.readdirSync(DIR).filter((name) => name >= (process.argv[2] ?? "20260923") && name.endsWith(".sql")).sort();
const client = new pg.Client({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const norm = (s) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
async function one(sql, params) { const r = await client.query(sql, params); return r.rows; }

const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(([\s\S]*?)\)\s*returns[\s\S]*?as\s+(\$[a-z_]*\$)([\s\S]*?)\3/gi;
// The newest file that defines each function, across EVERY migration. An older file's body is
// expected to differ once a later one replaces the function, so it is judged on existence only
// and reported as superseded — not as "not applied", which is what it looked like before.
const newestDefiner = new Map();
for (const file of fs.readdirSync(DIR).filter((name) => name.endsWith(".sql")).sort()) {
  for (const m of fs.readFileSync(`${DIR}/${file}`, "utf8").matchAll(fnRe)) newestDefiner.set(m[1].toLowerCase(), file);
}

for (const file of files) {
  const text = fs.readFileSync(`${DIR}/${file}`, "utf8");
  const problems = [];
  const superseded = [];
  let checks = 0;

  // Functions: the LAST definition in the file wins, so check that one.
  const lastBody = new Map();
  for (const m of text.matchAll(fnRe)) lastBody.set(m[1].toLowerCase(), m[4]);
  for (const [name, body] of lastBody) {
    checks += 1;
    const rows = await one("select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [name]);
    if (!rows.length) { problems.push(`function ${name} missing`); continue; }
    const newest = newestDefiner.get(name);
    if (newest && newest !== file) { superseded.push(`${name} → ${newest.slice(0, 14)}`); continue; }
    // A distinctive line: the longest non-trivial line of the body.
    const lines = body.split("\n").map((l) => norm(l)).filter((l) => l.length > 25 && !/^(begin|end|declare|return|if|else|loop)\b/i.test(l));
    const probe = lines.sort((a, b) => b.length - a.length)[0];
    if (probe && !rows.some((row) => norm(row.prosrc).includes(probe))) problems.push(`function ${name} body differs (probe: "${probe.slice(0, 70)}")`);
  }

  for (const m of text.matchAll(/create\s+table\s+if\s+not\s+exists\s+(?:public\.)?([a-z_0-9]+)/gi)) {
    checks += 1;
    const rows = await one("select to_regclass('public.' || $1) is not null as ok", [m[1]]);
    if (!rows[0].ok) problems.push(`table ${m[1]} missing`);
  }
  for (const m of text.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?([a-z_0-9]+)([\s\S]*?);/gi)) {
    for (const c of m[2].matchAll(/add\s+column\s+if\s+not\s+exists\s+"?([a-z_0-9]+)"?/gi)) {
      checks += 1;
      // pg_attribute, not information_schema.columns: the latter lists only columns the connecting
      // role (tenant_app) holds a privilege on, so a new column on a table tenant_app may not read
      // (subscriptions.trial_outcome, 2026-09-25) was reported missing while it was live.
      const rows = await one(
        "select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = $1 and a.attname = $2 and a.attnum > 0 and not a.attisdropped",
        [m[1], c[1]],
      );
      if (!rows.length) problems.push(`column ${m[1]}.${c[1]} missing`);
    }
  }
  for (const m of text.matchAll(/create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?([a-z_0-9]+)/gi)) {
    checks += 1;
    const rows = await one("select to_regclass('public.' || $1) is not null as ok", [m[1]]);
    if (!rows[0].ok) problems.push(`view ${m[1]} missing`);
  }

  const verdict = checks === 0 ? "?? no checkable objects" : problems.length === 0 ? "applied" : problems.length === checks ? "NOT APPLIED" : "PARTIAL / body differs";
  console.log(`${verdict.padEnd(22)} ${file}${problems.length ? `\n    - ${problems.slice(0, 4).join("\n    - ")}${problems.length > 4 ? `\n    - …${problems.length - 4} more` : ""}` : ""}${superseded.length && !problems.length ? `  (superseded: ${superseded.join(", ")})` : ""}`);
}
await client.end();
