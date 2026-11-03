/**
 * Which tables does this repo write to that still demand an organization_id?
 *
 * `organization_id` belongs to the organizations-era product. The tenant plane scopes by tenant_id
 * and never sets it, so any shared table where the column is NOT NULL rejects every write this
 * application makes. Three have already been found the slow way -- partners and partner_users on
 * 2026-09-12, then partner_products an hour later, each one costing a round of diagnosis.
 *
 * 144 live tables require the column; most are the other product's and irrelevant. The set that
 * matters is the intersection with tables THIS repo declares, which is what this prints.
 *
 *   node --env-file=.env.local scripts/check-orphan-org-columns.mjs
 */
import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";

const declared = new Set();
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql"))) {
  const sql = readFileSync(join(DIR, file), "utf8");
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.("?)([a-z0-9_]+)\1/gi)) {
    declared.add(m[2].toLowerCase());
  }
  // Also anything the repo inserts into or updates, which is the real signal of "we write here".
  for (const m of sql.matchAll(/(?:insert\s+into|update)\s+(?:public\.)?("?)([a-z0-9_]+)\1/gi)) {
    declared.add(m[2].toLowerCase());
  }
}

const c = new pg.Client({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const required = (await c.query(
  `select c.relname as t
     from pg_attribute a
     join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and a.attname = 'organization_id' and a.attnum > 0 and not a.attisdropped and a.attnotnull
    order by c.relname`
)).rows.map((r) => r.t);
await c.end();

const hits = required.filter((t) => declared.has(t));

console.log(`live tables requiring organization_id : ${required.length}`);
console.log(`of those, written by this repo        : ${hits.length}\n`);
for (const t of hits) console.log(`  ${t}`);
console.log(`\nEach of these rejects every tenant-plane write until the column is nullable.`);
