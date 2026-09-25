/**
 * Which triggers does this repository declare, and which of them exist in the live database?
 *
 * A trigger function surviving a migration while its trigger does not is the quietest defect this
 * project produces. The function is present, so nothing reports it missing; the code that reads as
 * complete simply never runs. It has happened three times:
 *
 *   tenants_seed_pipelines          new tenants got no pipelines, so no lead could be claimed
 *   LA-1.16's five                  no partner ever had a chat channel, and messages were never
 *                                   broadcast or audited
 *   two broadcast triggers          the partner board and agent notifications never updated live
 *
 * None of the three raised an error, failed a request, or appeared in a log. Each was found by
 * chasing an unrelated symptom.
 *
 * A trigger declared on a table that does not exist is reported separately -- that is a superseded
 * declaration (usually a table this application renamed), not a gap.
 *
 * Run: node --env-file=.env.local scripts/check-declared-triggers.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const dir = "supabase/migrations";
const declared = new Map(); // name -> { table, file }

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  // Last declaration wins: a later migration moving a trigger to another table is the current intent.
  for (const m of sql.matchAll(/create\s+trigger\s+(\w+)([\s\S]{0,200}?)\bon\s+public\.(\w+)/gi)) {
    declared.set(m[1], { table: m[3], file });
  }
}

const client = new pg.Client({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const live = await client.query(`
  select t.tgname as name, c.relname as table_name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal
`);
const tables = await client.query(`
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
`);
await client.end();

const liveByName = new Map(live.rows.map((r) => [r.name, r.table_name]));
const tableExists = new Set(tables.rows.map((r) => r.relname));

const missing = [];
const wrongTable = [];
const supersededTable = [];

for (const [name, { table, file }] of [...declared].sort()) {
  if (!tableExists.has(table)) { supersededTable.push(`${name} (declared on ${table}, which no longer exists)`); continue; }
  const liveTable = liveByName.get(name);
  if (!liveTable) { missing.push({ name, table, file }); continue; }
  if (liveTable !== table) wrongTable.push(`${name}: declared on ${table}, live on ${liveTable}`);
}

console.log(`triggers declared in migrations      : ${declared.size}`);
console.log(`present in the live database         : ${declared.size - missing.length - supersededTable.length}`);
console.log(`declared on a table that is now gone : ${supersededTable.length}`);
console.log(`MISSING                              : ${missing.length}\n`);

for (const { name, table, file } of missing) {
  console.log(`  ${name}`);
  console.log(`      on public.${table} — declared in ${file}`);
}
if (wrongTable.length) {
  console.log(`\nattached to a different table than declared (${wrongTable.length}):`);
  for (const w of wrongTable) console.log(`  ${w}`);
}
if (supersededTable.length) {
  console.log(`\nsuperseded declarations (${supersededTable.length}):`);
  for (const s of supersededTable) console.log(`  ${s}`);
}

process.exitCode = missing.length ? 1 : 0;
