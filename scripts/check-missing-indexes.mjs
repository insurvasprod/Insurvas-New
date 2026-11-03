/**
 * Finds indexes this repo declares that the live database does not have.
 *
 * Why this exists. The 2026-09-11 reconciliation emitted `create index` only for tables it created,
 * because an index on a pre-existing table was treated as touching the other product's schema. That
 * was the right default and it left a gap: a UNIQUE index is not decoration, it is the thing an
 * `insert ... on conflict (a, b)` resolves against. Without it the statement fails outright with
 *
 *   42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification
 *
 * which is how LA-1.3 lost eight acceptance criteria: set_partner_product_approval upserts on
 * (partner_id, product_code) and `partner_products` has no such key live.
 *
 * So this compares declared index names against the catalog and reports what is absent, flagging
 * the unique ones because those change behaviour rather than performance.
 *
 *   node --env-file=.env.local scripts/check-missing-indexes.mjs
 */
import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";

const declared = new Map(); // index name -> { unique, table, file }
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(DIR, file), "utf8");
  const re = /create\s+(unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?\s+on\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;
  for (const m of sql.matchAll(re)) {
    declared.set(m[2].toLowerCase(), { unique: Boolean(m[1]), table: m[3].toLowerCase(), file });
  }
}

const c = new pg.Client({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const live = new Set((await c.query(
  `select indexname from pg_indexes where schemaname = 'public'`
)).rows.map((r) => r.indexname.toLowerCase()));
const liveTables = new Set((await c.query(
  `select tablename from pg_tables where schemaname = 'public'`
)).rows.map((r) => r.tablename));
await c.end();

const missing = [...declared.entries()].filter(([name]) => !live.has(name));
// An index on a table that does not exist is a different problem and is already reported elsewhere.
const onLiveTables = missing.filter(([, v]) => liveTables.has(v.table));

const uniques = onLiveTables.filter(([, v]) => v.unique);
const plain = onLiveTables.filter(([, v]) => !v.unique);

console.log(`indexes declared by migrations : ${declared.size}`);
console.log(`missing from the database      : ${missing.length}`);
console.log(`  of those, on a live table    : ${onLiveTables.length}`);
console.log(`\nMISSING UNIQUE (${uniques.length}) — each of these can break an ON CONFLICT:`);
for (const [name, v] of uniques.sort((a, b) => a[1].table.localeCompare(b[1].table))) {
  console.log(`  ${v.table.padEnd(28)} ${name}`);
}
console.log(`\nmissing non-unique (${plain.length}) — performance only:`);
console.log(`  ${plain.map(([, v]) => v.table).filter((t, i, a) => a.indexOf(t) === i).sort().join(", ")}`);
