/**
 * Predicts the "column this repo has never heard of is NOT NULL" failure before a suite hits it.
 *
 * Three times today a write failed on a required column the tenant plane does not model, each
 * costing a round of diagnosis:
 *
 *   partners.slug                            LA-1.1, 6 criteria
 *   partner_products.name, .product_line     LA-1.3, 5 criteria
 *   partners/partner_users.organization_id   LA-1.1 and LA-1.2 (its own survey now)
 *
 * They share a shape: the table is shared with the organizations-era product, that product requires
 * a column, and this repo's CREATE TABLE for the same table never mentions it. So the application
 * cannot possibly supply it and every insert fails with 23502.
 *
 * This finds all of them at once by diffing the live NOT NULL columns against the columns this
 * repo's migrations declare for the same table.
 *
 * A column with a DEFAULT is fine -- the database fills it -- so only defaultless ones are
 * reported.
 *
 *   node --env-file=.env.local scripts/check-unmodelled-required-columns.mjs
 */
import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";

/** Column names this repo declares for each table, across CREATE TABLE and ADD COLUMN. */
const declared = new Map();
const add = (t, c) => {
  const k = t.toLowerCase();
  if (!declared.has(k)) declared.set(k, new Set());
  declared.get(k).add(c.toLowerCase());
};

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(DIR, file), "utf8");

  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.("?)([a-z0-9_]+)\1\s*\(/gi)) {
    const table = m[2];
    // Walk the parenthesised body and take the first identifier of each top-level item.
    let depth = 0, i = sql.indexOf("(", m.index + m[0].length - 1), start = i + 1;
    for (; i < sql.length; i++) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") { depth--; if (depth === 0) break; }
      else if (sql[i] === "," && depth === 1) {
        const item = sql.slice(start, i).replace(/--[^\n]*/g, "").trim();
        const name = item.match(/^"?([a-z0-9_]+)"?\s+\S/i);
        if (name) add(table, name[1]);
        start = i + 1;
      }
    }
    const last = sql.slice(start, i).replace(/--[^\n]*/g, "").trim();
    const lastName = last.match(/^"?([a-z0-9_]+)"?\s+\S/i);
    if (lastName) add(table, lastName[1]);
  }

  for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?public\.("?)([a-z0-9_]+)\1\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi)) {
    add(m[2], m[3]);
  }
}

const c = new pg.Client({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const rows = (await c.query(
  `select cl.relname as t, a.attname as col, format_type(a.atttypid, a.atttypmod) as ty
     from pg_attribute a
     join pg_class cl on cl.oid = a.attrelid
     left join pg_attrdef d on d.adrelid = cl.oid and d.adnum = a.attnum
    where cl.relnamespace = 'public'::regnamespace and cl.relkind = 'r'
      and a.attnum > 0 and not a.attisdropped and a.attnotnull and d.adbin is null
    order by cl.relname, a.attnum`
)).rows;
await c.end();

const hits = new Map();
for (const r of rows) {
  const cols = declared.get(r.t);
  if (!cols) continue;                 // a table this repo does not model at all: not our problem
  if (cols.has(r.col)) continue;       // modelled, so the application can supply it
  if (!hits.has(r.t)) hits.set(r.t, []);
  hits.get(r.t).push(`${r.col} ${r.ty}`);
}

console.log(`tables this repo models        : ${declared.size}`);
console.log(`of those, with a required column this repo never declares : ${hits.size}\n`);
for (const [t, cols] of [...hits].sort()) {
  console.log(`  ${t}`);
  for (const col of cols) console.log(`      ${col}`);
}
console.log(`\nEvery insert the tenant plane makes into these fails with 23502 until the column is`);
console.log(`nullable, given a default, or populated by the function that writes the row.`);
