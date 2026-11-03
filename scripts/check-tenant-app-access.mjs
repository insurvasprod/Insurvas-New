/**
 * Which tables does this repository declare tenant_app access for, and which of those actually have
 * it in the live database?
 *
 * A tenant-plane table needs BOTH to be readable: a GRANT, and a row-level security policy naming
 * tenant_app. A policy without a grant is a dead letter -- Postgres refuses at the privilege check
 * before RLS is ever evaluated, with 42501 permission denied. A grant without a policy is worse in
 * the other direction: RLS with no matching policy denies every row, so the table reads as empty
 * rather than as an error.
 *
 * Both halves were missing for public.partners, and the gap had been invisible because the check
 * that would have caught it -- LA-1.1's "direct tenant_app reads cannot cross tenants" -- asserted
 * `rows.every(...)` over a query that threw, and a suite that dies never reports a failed check.
 *
 * Run: node --env-file=.env.local scripts/check-tenant-app-access.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Tables this application renamed out of the way because the CRM owns the original name. The old
 * migrations still declare tenant_app access for the ORIGINAL, so without this map the survey
 * reports four gaps that are really four completed renames. The replacement carries the access.
 */
const RENAMED = new Map([
  ["pipelines", "tenant_pipelines"],
  ["pipeline_stages", "tenant_pipeline_stages"],
  ["verification_sessions", "tenant_verification_sessions"],
  ["disposition_flows", "tenant_disposition_flows"],
  ["lead_notes", "tenant_lead_notes"],
  ["callbacks", "tenant_callbacks"],
  ["lead_sla_events", "tenant_lead_sla_events"],
]);

const dir = "supabase/migrations";
const declared = new Map(); // table -> { policy: Set<file>, grant: Set<file> }

const note = (table, kind, file) => {
  if (!declared.has(table)) declared.set(table, { policy: new Set(), grant: new Set() });
  declared.get(table)[kind].add(file);
};

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
  const sql = fs.readFileSync(path.join(dir, file), "utf8");

  // create policy <name> on public.<table> ... to tenant_app
  for (const m of sql.matchAll(/create\s+policy\s+\S+\s+on\s+public\.(\w+)[\s\S]{0,200}?\bto\s+tenant_app\b/gi)) {
    note(m[1], "policy", file);
  }
  // grant <privs> on [table] public.<a>, public.<b> ... to ... tenant_app
  for (const m of sql.matchAll(/grant\s+[^;]*?\bon\s+(?:table\s+)?((?:public\.\w+\s*,?\s*)+)[^;]*?\bto\s+[^;]*?\btenant_app\b/gi)) {
    for (const t of m[1].matchAll(/public\.(\w+)/g)) note(t[1], "grant", file);
  }
}

const client = new pg.Client({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const live = await client.query(`
  select c.relname as table_name,
         c.relrowsecurity as rls,
         exists (select 1 from pg_policy p
                  where p.polrelid = c.oid
                    and (p.polroles = '{0}'::oid[]   -- TO PUBLIC covers every role
                      or 'tenant_app' = any (select rolname from pg_roles where oid = any (p.polroles)))) as has_policy,
         (exists (select 1 from information_schema.role_table_grants g
                  where g.table_schema = 'public' and g.table_name = c.relname
                    and g.grantee = 'tenant_app')
          or exists (select 1 from information_schema.column_privileges cp
                     where cp.table_schema = 'public' and cp.table_name = c.relname
                       and cp.grantee = 'tenant_app')) as has_grant
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'f', 'p')
`);
await client.end();

const byName = new Map(live.rows.map((r) => [r.table_name, r]));
const broken = [];
const missingTable = [];

const superseded = [];
for (const [table, where] of [...declared].sort()) {
  // A renamed table is checked at its new name; the old declaration is history, not a gap.
  const target = RENAMED.get(table);
  if (target) {
    const moved = byName.get(target);
    if (moved?.has_grant && moved?.has_policy) { superseded.push(`${table} -> ${target}`); continue; }
    if (moved) { broken.push([`${target} (renamed from ${table})`, [moved.has_grant ? "POLICY missing" : "GRANT missing"], [...where.policy, ...where.grant]]); continue; }
  }
  const row = byName.get(table);
  if (!row) { missingTable.push(table); continue; }
  const wantsPolicy = where.policy.size > 0;
  const wantsGrant = where.grant.size > 0;
  const problems = [];
  if (wantsGrant && !row.has_grant) problems.push("GRANT missing");
  if (wantsPolicy && !row.has_policy) problems.push("POLICY missing");
  // A grant with RLS on and no tenant_app policy reads as empty rather than erroring.
  if (row.has_grant && row.rls && !row.has_policy) problems.push("grant but no policy — reads empty, never errors");
  if (problems.length) broken.push([table, problems, [...new Set([...where.policy, ...where.grant])]]);
}

console.log(`tables this repo declares tenant_app access for : ${declared.size}`);
console.log(`of those, correct in the live database           : ${declared.size - broken.length - missingTable.length}`);
console.log(`declared but the table does not exist            : ${missingTable.length}`);
console.log(`superseded by a rename, checked at the new name : ${superseded.length}`);
console.log(`INCOMPLETE                                       : ${broken.length}\n`);

for (const [table, problems, files] of broken) {
  console.log(`  ${table}`);
  console.log(`      ${problems.join("; ")}`);
  console.log(`      declared in ${files.join(", ")}`);
}
if (missingTable.length) console.log(`\nnot present: ${missingTable.join(", ")}`);

process.exitCode = broken.length ? 1 : 0;
