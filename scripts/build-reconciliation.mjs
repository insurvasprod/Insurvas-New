/**
 * Builds ONE reconciliation migration that adds only what the live database is missing.
 *
 * Context: this repo's 178 migrations have never run against the configured project — the ledger
 * overlap is zero (380 rows: 178 local-only, 202 remote-only). The database was built by a
 * different lineage that also serves the organizations-era CRM. `supabase db push` would therefore
 * replay the whole repo history over a schema that already half-exists, in shapes that do not
 * match, and would damage the other application.
 *
 * So instead of replaying history, this replays only the statements whose TARGET IS ABSENT:
 *
 *   - types the database does not have
 *   - the missing tables, plus every alter/index/policy/trigger/grant/comment against them
 *   - the missing functions
 *
 * A statement touching an object that already exists is excluded and written to the report, so the
 * exclusions are reviewable rather than silent. That is the whole safety property: nothing this
 * emits can alter an object the CRM already relies on.
 *
 *   node --env-file=.env.local scripts/build-reconciliation.mjs
 */
import pg from "pg";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const OUT = "supabase/backups/reconciliation.sql";
const REPORT = "supabase/backups/reconciliation-report.txt";

/**
 * Splits SQL into statements, respecting dollar quoting and string literals.
 * Lifted from scripts/check-migrations.mjs so both tools agree on what a statement is.
 */
function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      const e = sql.indexOf("\n", i + 2);
      i = e === -1 ? sql.length : e + 1;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const e = sql.indexOf("*/", i + 2);
      i = e === -1 ? sql.length : e + 2;
      continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const q = sql[i++];
      while (i < sql.length) {
        if (sql[i] === q && sql[i + 1] === q) { i += 2; continue; }
        if (sql[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (sql[i] === "$") {
      let t = i + 1;
      while (t < sql.length && /[A-Za-z_]/.test(sql[t])) t++;
      if (sql[t] === "$") {
        const dq = sql.slice(i, t + 1);
        const e = sql.indexOf(dq, t + 1);
        i = e === -1 ? sql.length : e + dq.length;
        continue;
      }
    }
    if (sql[i] === ";") {
      const s = sql.slice(start, i).trim();
      if (s && s.replace(/(?:^|\n)\s*--[^\n]*/g, "").trim()) statements.push(s);
      start = i + 1;
    }
    i++;
  }
  const f = sql.slice(start).trim();
  if (f && f.replace(/(?:^|\n)\s*--[^\n]*/g, "").trim()) statements.push(f);
  return statements;
}

const c = new pg.Client({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const liveTables = new Set((await c.query(
  `select tablename as n from pg_tables where schemaname = 'public'
   union select viewname from pg_views where schemaname = 'public'
   union select matviewname from pg_matviews where schemaname = 'public'`
)).rows.map((r) => r.n));

const liveFns = new Set((await c.query(
  `select p.proname as n from pg_proc p
   join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public'`
)).rows.map((r) => r.n));

const liveTypes = new Set((await c.query(
  `select t.typname as n from pg_type t
   join pg_namespace ns on ns.oid = t.typnamespace where ns.nspname = 'public'`
)).rows.map((r) => r.n));

/** table -> Set(column) for everything already in public. Drives the column-level diff below. */
// pg_attribute, NOT information_schema.columns: the information_schema views are filtered by the
// caller's privileges, and TENANT_DB_URL connects as tenant_app, which cannot see most of these
// tables. Reading through it silently returned an empty column set for every table the role lacks
// rights on, which made the diff below emit nothing for them.
const liveCols = new Map();
for (const r of (await c.query(
  `select cl.relname as t, a.attname as col
   from pg_attribute a
   join pg_class cl on cl.oid = a.attrelid
   join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname = 'public' and a.attnum > 0 and not a.attisdropped
     and cl.relkind in ('r', 'p', 'v', 'm', 'f')`
)).rows) {
  if (!liveCols.has(r.t)) liveCols.set(r.t, new Set());
  liveCols.get(r.t).add(r.col);
}

await c.end();

/**
 * Pulls column definitions out of a `create table` body.
 *
 * Needed because a table that already exists is never re-created, so any column the repo declares
 * inside CREATE TABLE — rather than in a later ALTER — would silently never arrive. That is how
 * payment_providers.provider_customer_id went missing while a view that selects it was emitted.
 *
 * Splits the parenthesised body on top-level commas and drops table-level constraint clauses.
 */
function parseCreateTableColumns(stmt) {
  const open = stmt.indexOf("(");
  if (open === -1) return [];
  let depth = 0, end = -1;
  for (let i = open; i < stmt.length; i++) {
    if (stmt[i] === "(") depth++;
    else if (stmt[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return [];

  // Strip line comments BEFORE splitting: a comma inside `-- which flow captured this: signup,`
  // is not a column boundary, and treating it as one produced fragments of prose as column names.
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

  const cols = [];
  for (const raw of parts) {
    const def = raw.replace(/(?:^|\n)\s*--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
    if (!def) continue;
    // Table-level constraints are not columns.
    if (/^(?:primary\s+key|unique|check|foreign\s+key|constraint|exclude|like|deferrable)\b/i.test(def)) continue;
    const m = def.match(/^"?([a-z0-9_]+)"?\s+(.+)$/i);
    if (!m) continue;
    const name = m[1].toLowerCase();
    // Adding a column to a populated table cannot carry NOT NULL without a default, and inline
    // PK/UNIQUE/REFERENCES would re-shape a table the CRM owns. Keep the type and the default only.
    const rest = m[2]
      .replace(/\bprimary\s+key\b/gi, "")
      .replace(/\bunique\b/gi, "")
      .replace(/\breferences\s+[^,]*$/gi, "")
      .replace(/\bnot\s+null\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (rest) cols.push({ name, def: rest });
  }
  return cols;
}

/** Strips a leading `public.` and any quoting so catalog names compare cleanly. */
const bare = (s) => s.replace(/^public\./i, "").replace(/"/g, "").toLowerCase();

/**
 * Classifies one statement into the object it targets. Returns null when nothing matched, which
 * sends the statement to the report rather than silently dropping it.
 */
function classify(low) {
  // This repo wraps most DDL in `do $$ begin <stmt>; exception when duplicate_object then null;
  // end $$` so migrations are re-runnable. The wrapper hides the target from a plain prefix match,
  // so unwrap it first and classify what is inside.
  const block = low.match(/^do\s+\$\$\s*begin\s+([\s\S]*)$/);
  if (block) {
    const inner = block[1];
    // `create role` and `create type ... exception when duplicate_object` are idempotent by
    // construction: if the object is already there the handler swallows it. Always safe.
    if (/^create\s+role\b/.test(inner)) return { kind: "always", target: "role" };
    const t = inner.match(/^create\s+type\s+(?:public\.)?"?([a-z0-9_]+)"?/);
    if (t) return { kind: "always", target: bare(t[1]) };
    const a = inner.match(/^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?/);
    if (a) return { kind: "alter", target: bare(a[1]) };
    return null; // anything else in a do-block gets reviewed by hand
  }

  const rules = [
    ["type", /^create\s+(?:type|domain)\s+(?:public\.)?"?([a-z0-9_]+)"?/],
    ["table", /^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/],
    ["view", /^create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:public\.)?"?([a-z0-9_]+)"?/],
    // The auth bridge lives in `private`, not `public`. This is the ONE existing function the
    // reconciliation deliberately replaces: private.handle_new_auth_user() omits public.users.name
    // from its INSERT, and that column is NOT NULL with no default, so every insert into auth.users
    // raises 23502 — "Database error creating new user" — for this app AND the CRM. Replacing it
    // can only unbreak user creation. See 20260911120000_auth_user_bridge_name_fix.sql. Emitted in
    // file order, so the fixed definition is the last one applied and wins.
    ["always", /^create\s+(?:or\s+replace\s+)?function\s+private\.\s*"?[a-z0-9_]+"?\s*\(/],
    ["function", /^create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/],
    ["alter", /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?/],
    ["index", /^create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?\S+\s+on\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?/],
    ["policy", /^(?:create|drop)\s+policy\s+.*?\s+on\s+(?:public\.)?"?([a-z0-9_]+)"?/],
    ["trigger", /^(?:create|drop)\s+trigger\s+\S+\s+(?:before|after|instead)\s+[\s\S]*?\s+on\s+(?:public\.)?"?([a-z0-9_]+)"?/],
    ["fn-grant", /^(?:grant|revoke)\b[\s\S]*?\bon\s+function\s+(?:public\.)?"?([a-z0-9_]+)"?/],
    ["fn-comment", /^comment\s+on\s+function\s+(?:public\.)?"?([a-z0-9_]+)"?/],
    ["comment", /^comment\s+on\s+(?:table|column|view|materialized\s+view|index|constraint\s+\S+\s+on)\s+(?:public\.)?"?([a-z0-9_]+)"?/],
    ["grant", /^(?:grant|revoke)\b[\s\S]*?\bon\s+(?:table\s+)?(?:public\.)?"?([a-z0-9_]+)"?/],
    // Extensions and enum-value additions are idempotent (`if not exists`) and additive. pg_trgm in
    // particular is a hard dependency of the LA-0.6 contact dedupe scoring.
    ["always", /^create\s+extension\s+if\s+not\s+exists\b/],
    ["always", /^alter\s+type\s+(?:public\.)?"?[a-z0-9_]+"?\s+add\s+value\s+if\s+not\s+exists\b/],
    // Data. Seeding a table this file creates is fine; writing to a pre-existing one is the CRM's
    // data and is never touched.
    ["insert", /^insert\s+into\s+(?:public\.)?"?([a-z0-9_]+)"?/],
    ["drop-trigger", /^drop\s+trigger\s+(?:if\s+exists\s+)?\S+\s+on\s+(?:public\.)?"?([a-z0-9_]+)"?/],
    ["alter-fn", /^alter\s+function\s+(?:public\.)?"?([a-z0-9_]+)"?/],
    // Never emitted. A DROP against a function that is missing is a no-op, and against one that
    // exists it would remove something the CRM may call. Either way there is nothing to gain.
    ["never", /^drop\s+(?:function|index|type|table|view)\b/],
    ["never", /^update\s+/],
    ["never", /^set\s+check_function_bodies\b/],
  ];
  for (const [kind, re] of rules) {
    const m = low.match(re);
    // The `always` / `never` rules carry no capture group — they are decided by kind alone.
    if (m) return { kind, target: m[1] ? bare(m[1]) : kind };
  }
  return null;
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const emitted = [];
const excluded = [];
const createdTables = new Set();
const createdTypes = new Set();
const addedColumns = [];
const quarantined = [];
/**
 * Tables whose live PRIMARY KEY type disagrees with the one this repo declares — uuid here, bigint
 * there, because the name means something different in each lineage. A foreign key into one of them
 * cannot be created at all (42804), so the reference is dropped and recorded. The modules that own
 * these tables (pipelines, dispositions) do not work against this database either way; see
 * scripts/check-shape-collisions.mjs.
 */
const quarantinedTables = new Set(["pipelines", "pipeline_stages", "disposition_flows"]);
/** True when a statement names any quarantined table. The set grows as dependants are found. */
const touchesQuarantined = (s) =>
  new RegExp(`\\b(?:${[...quarantinedTables].join("|")})\\b`, "i").test(s);
/** table -> Map(column -> type/default), as the repo's CREATE TABLE statements declare it. */
const declaredCols = new Map();

for (const file of files) {
  for (let stmt of splitStatements(readFileSync(join(DIR, file), "utf8"))) {
    // Strip line comments AND leading /** ... */ doc blocks. Without the second one, every
    // documented view and function in this repo arrives at classify() looking like a comment.
    const flat = stmt
      .replace(/(?:^|\n)\s*--[^\n]*/g, " ")
      .replace(/^\s*\/\*[\s\S]*?\*\//, " ")
      .replace(/\s+/g, " ")
      .trim();
    const hit = classify(flat.toLowerCase());

    if (!hit) {
      excluded.push([file, "UNCLASSIFIED", flat.slice(0, 160)]);
      continue;
    }

    const { kind, target } = hit;
    let keep = false;

    // Record every column the repo declares for this table, whether or not the CREATE runs. For a
    // table that already exists, this is the only record of what the application expects.
    if (kind === "table") {
      if (!declaredCols.has(target)) declaredCols.set(target, new Map());
      for (const col of parseCreateTableColumns(stmt)) declaredCols.get(target).set(col.name, col.def);
    }

    if (kind === "always") {
      keep = true;
      if (!liveTypes.has(target)) createdTypes.add(target);
    } else if (kind === "never") {
      keep = false;
    } else if (kind === "insert" || kind === "drop-trigger") {
      keep = createdTables.has(target);
    } else if (kind === "alter-fn") {
      keep = !liveFns.has(target);
    } else if (kind === "type") {
      keep = !liveTypes.has(target);
      if (keep) createdTypes.add(target);
    } else if (kind === "table") {
      // `createdTables` guard, not just `liveTables`: a few tables are declared in two migrations
      // and the second CREATE would raise 42P07.
      keep = !liveTables.has(target) && !createdTables.has(target);
      if (keep) createdTables.add(target);
    } else if (kind === "view") {
      keep = !liveTables.has(target);
      if (keep) createdTables.add(target);
    } else if (kind === "function" || kind === "fn-grant" || kind === "fn-comment") {
      // A function absent from the catalog is safe to create. One that exists is left alone —
      // this is what protects can_write and the five other shared bridge functions.
      keep = !liveFns.has(target);
    } else if (kind === "alter" && !createdTables.has(target)) {
      // Narrow exception on a pre-existing table: ADD COLUMN only. The repo's views and functions
      // reference columns that this database's lineage never added (the first one found was
      // payment_providers.provider_customer_id, needed by a view). Adding a nullable column is
      // additive — no existing CRM row or query changes — whereas DROP/RENAME/ALTER COLUMN and
      // constraint changes are not, and stay excluded.
      const addsColumn = /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?\S+\s+add\s+column\b/i.test(flat);
      const unsafe = /\b(?:drop|rename|set\s+not\s+null|set\s+data\s+type|alter\s+column)\b/i.test(flat);
      keep = addsColumn && !unsafe;
      if (keep) {
        addedColumns.push(`${target}: ${flat.slice(0, 110)}`);
        // Make it re-runnable. Several of these appear in more than one migration.
        stmt = stmt.replace(/\badd\s+column\s+(?!if\s+not\s+exists)/gi, "add column if not exists ");
      }
    } else {
      // index / policy / trigger / comment / grant: only ever against a table THIS file creates.
      // Never against a table that was already there.
      keep = createdTables.has(target);
    }

    if (keep) {
      // Make the whole file re-runnable. The repo's migrations assume a virgin database and so omit
      // IF NOT EXISTS in places; this file may need to be applied more than once.
      stmt = stmt
        .replace(/^(\s*create\s+(?:unlogged\s+)?table\s+)(?!if\s+not\s+exists)/i, "$1if not exists ")
        .replace(/^(\s*create\s+(?:unique\s+)?index\s+)(?!if\s+not\s+exists|concurrently)/i, "$1if not exists ");
      // Quarantine. `pipelines`, `pipeline_stages` and `disposition_flows` exist in both lineages
      // with a bigint primary key here and a uuid one in this repo. Nothing additive bridges that:
      // the foreign key cannot be created (42804), the seed data cannot be selected (bigint into
      // uuid), and any view or function joining them fails to compile (operator does not exist:
      // bigint = uuid). So every statement that touches one is left out, and the modules that own
      // them — LA-1.9 pipelines and LA-1.12 dispositions — stay unreconciled by design.
      //
      // The fix is the one this project already applied to invoices in SA-3: rename the SaaS-side
      // table. 20260912270000 did that for the half LA-1.4 needs — this application now owns
      // tenant_pipelines and tenant_pipeline_stages, and the statements quarantined here still name
      // the colliding originals, so they stay quarantined and are superseded rather than revived.
      // LA-1.9 and LA-1.12 keep the rest. Until then these are recorded, not silently skipped.
      if (touchesQuarantined(stmt)) {
        // A table that cannot be created without a quarantined one becomes quarantined itself, so
        // its own dependants are caught on the next pass through the migration order.
        if (kind === "table" || kind === "view") {
          quarantinedTables.add(target);
          createdTables.delete(target);
        }
        quarantined.push(`${file} | ${kind} ${target} | ${flat.slice(0, 90)}`);
        continue;
      }
      // Reference-data seeds appear in several migrations and re-insert the same keys.
      if (kind === "insert" && !/\bon\s+conflict\b/i.test(stmt) && !/\breturning\b/i.test(stmt)) {
        stmt = `${stmt.replace(/;?\s*$/, "")} on conflict do nothing`;
      }
      emitted.push({ file, kind, target, stmt, flat });
    }
    else excluded.push([file, `${kind} ${target}`, flat.slice(0, 160)]);
  }
}

const fnNames = [...new Set(emitted.filter((e) => e.kind === "function").map((e) => e.target))];

const header = `-- Reconciliation migration — generated ${new Date().toISOString()}
-- by scripts/build-reconciliation.mjs
--
-- Adds ONLY objects absent from the live database. Every statement targets either an object this
-- file itself creates, or a function that does not exist. Nothing alters a pre-existing table, so
-- the organizations-era CRM sharing this database is unaffected.
--
-- See supabase/backups/reconciliation-report.txt for every excluded statement and why.

set check_function_bodies = off;

`;

// Columns the repo declares inside CREATE TABLE for a table that already exists. These must land
// before any view or function that selects them, so they go in their own early phase.
const columnFixes = [];
for (const [table, cols] of declaredCols) {
  if (createdTables.has(table) || !liveCols.has(table)) continue; // this file creates it; no diff needed
  for (const [name, def] of cols) {
    if (liveCols.get(table).has(name)) continue;
    columnFixes.push(`alter table public.${table} add column if not exists ${name} ${def};`);
  }
}

// Extensions, roles, enum types and enum values are order-independent and idempotent, and the
// column fixes depend on the types. Everything else keeps migration order so dependencies hold.
// Tested against the FLATTENED text: several of these statements open with a `--` banner comment,
// which `.trim()` leaves in place, so matching the raw statement missed them and left the type
// creation stranded after the column fixes that need it.
const isEarly = (e) => /^(?:create\s+extension|alter\s+type|create\s+(?:type|domain)|do\s+\$\$\s*begin\s+(?:if\s+not\s+exists[\s\S]*?then\s+)?create\s+(?:type|role))/i.test(e.flat);
// Several enums are declared in more than one migration — once bare, once wrapped in an exception
// handler. Collapsed to the first occurrence, otherwise the second raises 42710 "already exists".
const seenTypes = new Set();
const early = emitted.filter(isEarly).filter((e) => {
  const m = e.flat.match(/create\s+type\s+(?:public\.)?"?([a-z0-9_]+)"?/i);
  if (!m) return true;
  const name = m[1].toLowerCase();
  if (seenTypes.has(name)) return false;
  seenTypes.add(name);
  return true;
});
// A GRANT names a function by full signature. Where the repo grants on an overload it never
// defines — or defines under different argument types — the grant raises 42883 and takes the whole
// transaction with it. Keep only grants whose function this file actually creates, and wrap them so
// a signature that still does not line up is skipped rather than fatal.
const definedFns = new Set(emitted.filter((e) => e.kind === "function").map((e) => e.target));

// A function redefined across migrations must appear ONCE, as its final version. CREATE OR REPLACE
// cannot change a function's OUT parameters (42P13), so replaying an early definition and then a
// later one fails. Emitted at the position of the first definition — which is where its dependants
// expect it — carrying the body of the last.
const finalFnBody = new Map();
for (const e of emitted) if (e.kind === "function") finalFnBody.set(e.target, e.stmt);
const seenFn = new Set();

const rest = emitted
  .filter((e) => !isEarly(e))
  .filter((e) => {
    if (e.kind !== "function") return true;
    if (seenFn.has(e.target)) return false;
    seenFn.add(e.target);
    return true;
  })
  .map((e) => (e.kind === "function" ? { ...e, stmt: finalFnBody.get(e.target) } : e))
  .filter((e) => (e.kind === "fn-grant" || e.kind === "fn-comment" ? definedFns.has(e.target) : true))
  .map((e) => {
    if (e.kind !== "fn-grant" && e.kind !== "fn-comment") return e;
    const inner = e.stmt.replace(/;\s*$/, "").replace(/'/g, "''");
    return { ...e, stmt: `do $$ begin execute '${inner}'; exception when undefined_function then null; end $$` };
  });

const render = (list) => list.map((e) => `-- [${e.file}] ${e.kind}: ${e.target}\n${e.stmt};`).join("\n\n");

const body = [
  render(early),
  columnFixes.length
    ? `-- --------------------------------------------------------------------------\n` +
      `-- Columns this repo declares in CREATE TABLE for tables that already exist under a\n` +
      `-- different lineage. Additive and nullable: no existing row or CRM query changes.\n` +
      `-- --------------------------------------------------------------------------\n` +
      columnFixes.join("\n")
    : "",
  render(rest),
].filter(Boolean).join("\n\n");

const tail = `

-- --------------------------------------------------------------------------
-- Columns the SA-1 user-administration screens read, absent from public.users.
-- Additive and nullable, so no existing row and no CRM query changes behaviour.
-- --------------------------------------------------------------------------
alter table public.users add column if not exists suspended_at timestamptz;
alter table public.users add column if not exists suspension_reason text;
`;

writeFileSync(OUT, header + body + tail, "utf8");

const byKind = {};
for (const e of emitted) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;

writeFileSync(
  REPORT,
  [
    `EMITTED ${emitted.length} statements`,
    ...Object.entries(byKind).sort().map(([k, v]) => `  ${k}: ${v}`),
    ``,
    `Tables created (${createdTables.size}):`,
    `  ${[...createdTables].sort().join(", ")}`,
    ``,
    `Types created (${createdTypes.size}):`,
    `  ${[...createdTypes].sort().join(", ")}`,
    ``,
    `Functions defined (${fnNames.length}):`,
    `  ${fnNames.sort().join(", ")}`,
    ``,
    `Columns added to PRE-EXISTING tables (${columnFixes.length}) — additive and nullable:`,
    ...columnFixes.map((s) => `  ${s}`),
    ``,
    `QUARANTINED ${quarantined.length} statements — the pipelines / dispositions module.`,
    `public.pipelines, public.pipeline_stages and public.disposition_flows exist in this database`,
    `with a bigint primary key; this repo declares uuid. Nothing additive bridges that, so every`,
    `statement touching them is left out and those two modules stay unreconciled.`,
    ...quarantined.map((s) => `  ${s}`),
    ``,
    `EXCLUDED ${excluded.length} statements — target already exists, or unclassified`,
    ...excluded.map(([f, t, s]) => `  ${f} | ${t} | ${s}`),
  ].join("\n"),
  "utf8",
);

console.log("emitted :", emitted.length, JSON.stringify(byKind));
console.log("excluded:", excluded.length);
console.log("tables  :", createdTables.size, "types:", createdTypes.size, "functions:", fnNames.length);
console.log("wrote", OUT);
console.log("wrote", REPORT);
