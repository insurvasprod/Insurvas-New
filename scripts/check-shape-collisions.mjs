/**
 * Compares the shape this repo declares for a table against the shape the live database has.
 *
 * Both lineages sharing this database use some of the same table names for different things. Where
 * the column types disagree, no additive reconciliation can help: a foreign key from a new table to
 * an old one fails outright (uuid vs bigint), and any application query against that table is
 * already wrong. This prints exactly which tables are in that state.
 *
 *   node --env-file=.env.local scripts/check-shape-collisions.mjs
 */
import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";

/** Normalises a declared SQL type to the catalog's spelling so the two can be compared. */
function normalise(t) {
  // `public.partner_status` and `partner_status` are the same type; only the spelling differs
  // between a migration and the catalog.
  const s = t.toLowerCase().replace(/\s+/g, " ").replace(/\bpublic\./g, "").trim();
  if (/^uuid/.test(s)) return "uuid";
  if (/^(bigserial|bigint|int8)/.test(s)) return "bigint";
  if (/^(serial|integer|int4|int)\b/.test(s)) return "integer";
  if (/^(text|citext)/.test(s)) return "text";
  if (/^(varchar|character varying)/.test(s)) return "text";
  if (/^(timestamptz|timestamp with time zone)/.test(s)) return "timestamptz";
  if (/^(timestamp|timestamp without time zone)/.test(s)) return "timestamp";
  if (/^(bool|boolean)/.test(s)) return "boolean";
  if (/^(jsonb)/.test(s)) return "jsonb";
  if (/^(numeric|decimal)/.test(s)) return "numeric";
  if (/^(date)/.test(s)) return "date";
  return s.split(" ")[0];
}

function columnsOf(stmt) {
  const open = stmt.indexOf("(");
  if (open === -1) return [];
  let depth = 0, end = -1;
  for (let i = open; i < stmt.length; i++) {
    if (stmt[i] === "(") depth++;
    else if (stmt[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return [];
  const inner = stmt.slice(open + 1, end).replace(/--[^\n]*/g, "");
  const parts = [];
  let buf = "", d = 0;
  for (const ch of inner) {
    if (ch === "(") d++;
    if (ch === ")") d--;
    if (ch === "," && d === 0) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  parts.push(buf);
  const out = [];
  for (const raw of parts) {
    const def = raw.replace(/\s+/g, " ").trim();
    if (!def || /^(?:primary key|unique|check|foreign key|constraint|exclude|like|deferrable)\b/i.test(def)) continue;
    const m = def.match(/^"?([a-z0-9_]+)"?\s+(.+)$/i);
    if (m) out.push({ name: m[1].toLowerCase(), type: normalise(m[2]) });
  }
  return out;
}

const c = new pg.Client({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const live = new Map();
for (const r of (await c.query(
  `select cl.relname as t, a.attname as col, format_type(a.atttypid, null) as ty
   from pg_attribute a
   join pg_class cl on cl.oid = a.attrelid
   join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname = 'public' and a.attnum > 0 and not a.attisdropped and cl.relkind in ('r','p')`
)).rows) {
  if (!live.has(r.t)) live.set(r.t, new Map());
  live.get(r.t).set(r.col, normalise(r.ty));
}
await c.end();

const declared = new Map();
for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(DIR, f), "utf8");
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.("?)([a-z0-9_]+)\1\s*\(/gi)) {
    const start = m.index + m[0].length - 1;
    const cols = columnsOf(sql.slice(start));
    if (!declared.has(m[2].toLowerCase())) declared.set(m[2].toLowerCase(), new Map());
    for (const col of cols) declared.get(m[2].toLowerCase()).set(col.name, col.type);
  }
}

const collisions = [];
for (const [table, cols] of declared) {
  if (!live.has(table)) continue;
  const bad = [];
  for (const [name, ty] of cols) {
    const liveTy = live.get(table).get(name);
    if (liveTy && liveTy !== ty) bad.push(`${name}: repo ${ty} vs live ${liveTy}`);
  }
  if (bad.length) collisions.push([table, bad]);
}

collisions.sort((a, b) => b[1].length - a[1].length);
console.log(`Tables declared by this repo that also exist live : ${[...declared.keys()].filter((t) => live.has(t)).length}`);
console.log(`Of those, SHAPE-INCOMPATIBLE                      : ${collisions.length}\n`);
for (const [t, bad] of collisions) {
  console.log(`${t}  (${bad.length} column${bad.length > 1 ? "s" : ""})`);
  for (const b of bad.slice(0, 6)) console.log(`    ${b}`);
  if (bad.length > 6) console.log(`    … and ${bad.length - 6} more`);
}
