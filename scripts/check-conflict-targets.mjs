/**
 * Every `insert ... on conflict (a, b)` needs a unique index on exactly (a, b). This finds the ones
 * that do not have it.
 *
 * `42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification` has now
 * cost three separate rounds of diagnosis today -- set_partner_product_approval, then
 * admin_apply_tenant_template with five targets of its own. The cause is always the same: this
 * database was built by a different migration lineage, and a uniqueness rule this repo declares
 * simply is not here.
 *
 * scripts/check-missing-indexes.mjs does not catch these, because it matches by index NAME and the
 * rules that matter are often declared as inline table constraints, which Postgres names itself.
 * This matches by COLUMN SET instead, which is what ON CONFLICT actually resolves against.
 *
 * A partial unique index only satisfies an ON CONFLICT when the statement repeats the predicate, so
 * partial indexes are reported as non-matching unless the statement carries a WHERE too. That is a
 * real distinction, not pedantry -- it is exactly the mistake made in 20260912160000.
 *
 *   node --env-file=.env.local scripts/check-conflict-targets.mjs
 */
import pg from "pg";

const c = new pg.Client({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const fns = (await c.query(
  `select p.proname, pg_get_functiondef(p.oid) as def
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'`
)).rows;

/** Unique indexes live, as a set of column names per table. Partial ones are flagged. */
const uniques = new Map(); // table -> [{cols:Set, partial:boolean, name}]
for (const r of (await c.query(
  `select t.relname as tbl, i.relname as idx, ix.indisunique as uniq,
          ix.indpred is not null as partial,
          -- ::text matters. attname has the name type, and node-postgres has no parser for its
          -- array, so it returns the literal string {id} and every comparison below silently fails.
          array_agg(a.attname::text order by a.attname::text) as cols
     from pg_index ix
     join pg_class i on i.oid = ix.indexrelid
     join pg_class t on t.oid = ix.indrelid
     join pg_namespace n on n.oid = t.relnamespace
     join pg_attribute a on a.attrelid = t.oid and a.attnum = any(ix.indkey)
    where n.nspname = 'public' and ix.indisunique
    group by t.relname, i.relname, ix.indisunique, ix.indpred`
)).rows) {
  if (!uniques.has(r.tbl)) uniques.set(r.tbl, []);
  uniques.get(r.tbl).push({ cols: new Set(r.cols), partial: r.partial, name: r.idx });
}

const problems = [];
for (const { proname, def } of fns) {
  // Bounded to ONE statement: `insert into T ... ;` with no semicolon in between. Without that the
  // match runs past the end of the insert and pairs a table with a later statement's ON CONFLICT,
  // which invents problems that do not exist (audit_log(work_item_id, rung) and friends).
  const re = /insert\s+into\s+(?:public\.)?"?([a-z0-9_]+)"?((?:[^;])*?)on\s+conflict\s*\(([^)]*)\)([^;]{0,80})/gi;
  for (const m of def.matchAll(re)) {
    const table = m[1].toLowerCase();
    const cols = m[3].split(",").map((s) => s.trim().replace(/"/g, "").toLowerCase()).filter(Boolean);
    if (cols.length === 0) continue;
    const stmtHasWhere = /\bwhere\b/i.test(m[4] ?? "");
    const candidates = uniques.get(table) ?? [];
    const ok = candidates.some((u) =>
      u.cols.size === cols.length && cols.every((col) => u.cols.has(col)) && (!u.partial || stmtHasWhere));
    if (!ok) problems.push({ proname, table, cols: cols.join(", "), why: candidates.some((u) => u.cols.size === cols.length && cols.every((col) => u.cols.has(col))) ? "only a PARTIAL index matches, and the statement has no WHERE" : "no unique index on these columns" });
  }
}

await c.end();

console.log(`functions scanned        : ${fns.length}`);
console.log(`ON CONFLICT targets with no usable unique index : ${problems.length}\n`);
const seen = new Set();
for (const p of problems) {
  const key = `${p.table}(${p.cols})`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`  ${p.table}(${p.cols})`);
  console.log(`      needed by ${p.proname} — ${p.why}`);
}
if (problems.length) {
  console.log(`\nEach of these raises 42P10 at runtime and takes the whole request with it.`);
}
process.exitCode = problems.length > 0 ? 1 : 0;
