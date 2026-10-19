// Rehearses a CHAIN of migration files, in order, in ONE transaction against the live database, then ROLLBACK.
//   node --env-file=<repo>/.env.local rehearse-chain.mjs <version> <version> ...
//
// The rehearsal role (tenant_app) owns nothing in public, so everything the chain touches is moved to pg_temp:
//   · functions a file creates, patches in place, or looks up by name are first COPIED from live into pg_temp, so an
//     in-place patch really reads, edits and re-creates the function and the file's own assertions read the result;
//   · tables / views a file creates, alters, or hangs triggers / policies / indexes on are COPIED (structure, plus the
//     rows this role can read) into pg_temp;
//   · `public.X` / `private.X` for those names, unqualified calls to those functions, catalog lookups in public, and
//     dynamic `execute` text are all pointed at pg_temp, consistently, in the files AND the copied definitions.
// The files' "skip if I cannot create in public" guards are turned off; transaction control is dropped. Each
// statement runs in a savepoint: a permission error that genuinely needs the owner is listed as NEEDS-OWNER (never
// hidden); anything else is a FAIL with its statement. Rolled back at the end, and checked for leftovers.
import fs from "node:fs";
import { createRequire } from "node:module";
const R = process.cwd(); // run from the repository root
const DIR = `${R}/supabase/migrations`;
const pg = createRequire(`${R}/package.json`)("pg");

const all = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const files = process.argv.slice(2).map((v) => { const f = all.find((x) => x.startsWith(v)); if (!f) throw new Error(`no file ${v}`); return f; });
const raw = new Map(files.map((f) => [f, fs.readFileSync(`${DIR}/${f}`, "utf8").replace(/\r\n/g, "\n")]));
const noComments = (t) => t.replace(/--[^\n]*/g, "");

// ── what the chain touches ──────────────────────────────────────────────────────────────────────────
const fnNames = new Set(); const tblNames = new Set();
const add = (set, n) => n && set.add(n.toLowerCase());
for (const f of files) {
  const t = noComments(raw.get(f));
  for (const m of t.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:(?:public|private)\.)?"?([a-z_0-9]+)"?\s*\(/gi)) add(fnNames, m[1]);
  for (const m of t.matchAll(/pg_get_functiondef\(\s*'(?:(?:public|private)\.)?([a-z_0-9]+)/gi)) add(fnNames, m[1]);
  for (const m of t.matchAll(/'(?:(?:public|private)\.)?([a-z_0-9]+)\([^']*\)'::regprocedure/gi)) add(fnNames, m[1]);
  for (const m of t.matchAll(/to_regprocedure\(\s*'(?:public|private)\.([a-z_0-9]+)/gi)) add(fnNames, m[1]);
  for (const m of t.matchAll(/proname\s*=\s*'([a-z_0-9]+)'/gi)) add(fnNames, m[1]);
  for (const m of t.matchAll(/proname\s+in\s*\(([^)]*)\)/gi)) for (const n of m[1].matchAll(/'([a-z_0-9]+)'/gi)) add(fnNames, n[1]);
  for (const m of t.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_0-9]+)/gi)) add(tblNames, m[1]);
  for (const m of t.matchAll(/create\s+(?:or\s+replace\s+)?view\s+public\.([a-z_0-9]+)/gi)) add(tblNames, m[1]);
  for (const m of t.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?public\.([a-z_0-9]+)/gi)) add(tblNames, m[1]);
  for (const m of t.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?[a-z_0-9"]+\s+on\s+(?:only\s+)?public\.([a-z_0-9]+)/gi)) add(tblNames, m[1]);
  for (const m of t.matchAll(/create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+[a-z_0-9"]+[\s\S]{0,300}?\son\s+public\.([a-z_0-9]+)/gi)) add(tblNames, m[1]);
  for (const m of t.matchAll(/(?:create|drop)\s+policy\s+(?:if\s+exists\s+)?[a-z_0-9"]+\s+on\s+public\.([a-z_0-9]+)/gi)) add(tblNames, m[1]);
}

const c = new pg.Client({ connectionString: process.env.TENANT_DB_URL });
await c.connect();
await c.query("begin");
await c.query("set local statement_timeout = '120s'");
await c.query("set local lock_timeout = '5s'");
const q = async (sql, p) => (await c.query(sql, p)).rows;
const tryq = async (sql) => { await c.query("savepoint s"); try { await c.query(sql); await c.query("release savepoint s"); return null; } catch (e) { await c.query("rollback to savepoint s"); return e; } };

const report = { copiedFns: [], copiedTables: [], needsOwner: [], fails: [], ran: 0 };
let fatal = false;
try {
  const moveTables = new Set();
  // any quoted name in the files that is a live public/private function (patch lists name their targets in arrays)
  const liveNames = new Set((await q("select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')")).map((r) => r.proname));
  for (const f of files) for (const m of noComments(raw.get(f)).matchAll(/'([a-z_][a-z_0-9]{3,})'/g)) if (liveNames.has(m[1])) fnNames.add(m[1]);
  const fnAlt = [...fnNames].join("|");
  // ── the text rewrite, used for the files AND for the copied live definitions ──────────────────────
  const rename = (sql) => {
    let s = sql;
    if (fnAlt) {
      s = s.replace(new RegExp(`\\b(?:public|private)\\.(${fnAlt})\\b`, "gi"), "pg_temp.$1");
      // unqualified calls: functions in pg_temp are never found through search_path
      s = s.replace(new RegExp(`(^|[^.\\w"$'])(${fnAlt})(\\s*\\()`, "gim"), "$1pg_temp.$2$3");
    }
    for (const t of moveTables) s = s.replace(new RegExp(`\\bpublic\\.${t}\\b`, "gi"), `pg_temp.${t}`);
    s = s.replace(/\bcron\.schedule\(/gi, "pg_temp.cron_schedule(").replace(/\bcron\.unschedule\(/gi, "pg_temp.cron_unschedule(").replace(/\bcron\.job\b/gi, "pg_temp.cron_job");
    s = s.replace(/if\s+not\s+has_schema_privilege\(\s*current_user\s*,\s*'(?:public|private)'\s*,\s*'CREATE'\s*\)\s+then/gi, "if false then");
    s = s.replace(/pronamespace\s*=\s*'(?:public|private)'::regnamespace/gi, "pronamespace = pg_my_temp_schema()");
    // a function looked up by schema name (any alias: n.nspname, s.nspname, …) — but only in pg_proc lookups,
    // which the chain's copies answer; relation lookups (pg_indexes.schemaname, pg_class) are left alone
    s = s.replace(/\b(\w+)\.nspname\s*=\s*'(?:public|private)'/gi, "$1.nspname = pg_my_temp_schema()::regnamespace::text");
    s = s.replace(/to_regclass\(\s*'public\.([a-z_0-9]+)'\s*\)/gi, "pg_temp.rh_regclass('$1')");
    // dynamic SQL a patch executes: point any public/private function header or moved table at pg_temp.
    // Only the SQL expression is wrapped: a trailing `into …` / `using …` at depth 0 stays outside.
    // a dollar-quoted statement (execute $sql$ … $sql$;) is wrapped whole
    s = s.replace(/(^|\bthen|\bloop|\belse)(\s*)execute\s+(\$[a-z_0-9]*\$)([\s\S]*?)\3/gim, (m, lead, ws, tag, inner) => `${lead}${ws}execute pg_temp.rh_to_temp(${tag}${inner}${tag})`);
    // only an `execute` that starts a statement (a line, or after then / loop / else) — never the word inside text
    s = s.replace(/(^|\bthen|\bloop|\belse)(\s*)execute\s+(?!function\b|procedure\b|on\b|pg_temp\.rh_to_temp\()([^;]+);/gim, (m, lead, ws, body) => {
      let depth = 0; let cut = body.length; let inStr = false;
      for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === "'") { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (depth === 0 && /\s/.test(ch) && /^\s+(into|using)\b/i.test(body.slice(i))) { cut = i; break; }
      }
      return `${lead}${ws}execute pg_temp.rh_to_temp(${body.slice(0, cut).trim()})${body.slice(cut)};`;
    });
    s = s.replace(/\bconcurrently\b/gi, "");
    // revoking from tenant_app would revoke from the owner of the rehearsal's own copies
    s = s.replace(/(revoke[^;]*?\bfrom\s+)([^;]*);/gi, (m, head, roles) => {
      const kept = roles.split(",").map((r) => r.trim()).filter((r) => r && r.toLowerCase() !== "tenant_app");
      return `${head}${kept.length ? kept.join(", ") : "anon"};`;
    });
    // temp tables may not reference permanent tables
    s = s.replace(/^\s*constraint\s+\w+\s+foreign\s+key\s*\([^)]*\)\s+references\s+public\.\w+\s*(\([^)]*\))?[^,\n]*,?[ \t]*$/gim, "");
    s = s.replace(/\breferences\s+public\.\w+(\s*\([^)]*\))?(\s+on\s+(delete|update)\s+(cascade|restrict|set\s+null|set\s+default|no\s+action))*/gi, "");
    s = s.replace(/add\s+constraint\s+\w+\s+foreign\s+key[^;,]*/gi, "add column if not exists rehearsal_fk_stripped boolean");
    return s;
  };

  // ── helpers and pg_cron stand-ins ─────────────────────────────────────────────────────────────────
  await c.query("create temp table cron_job (jobid bigserial, jobname text, schedule text, command text, active boolean default true)");
  await c.query("create function pg_temp.cron_schedule(text, text, text) returns bigint language sql as $$ insert into pg_temp.cron_job (jobname, schedule, command) values ($1, $2, $3) returning jobid $$");
  await c.query("create function pg_temp.cron_schedule(text, text) returns bigint language sql as $$ insert into pg_temp.cron_job (schedule, command) values ($1, $2) returning jobid $$");
  await c.query("create function pg_temp.cron_unschedule(text) returns boolean language sql as $$ delete from pg_temp.cron_job where jobname = $1 returning true $$");
  await c.query("create function pg_temp.cron_unschedule(bigint) returns boolean language sql as $$ delete from pg_temp.cron_job where jobid = $1 returning true $$");
  await c.query("create function pg_temp.rh_regclass(text) returns regclass language sql stable as $$ select coalesce(to_regclass('pg_temp.' || $1), to_regclass('public.' || $1)) $$");

  // ── copy live tables the chain changes ───────────────────────────────────────────────────────────
  for (const t of tblNames) {
    const live = (await q("select c.relkind, c.reltuples from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = $1", [t]))[0];
    if (!live || live.relkind === "v" || live.relkind === "m") { moveTables.add(t); continue; } // new, or a view the chain (re)creates
    let e = await tryq(`create temp table ${t} (like public.${t} including defaults including constraints including indexes including generated)`);
    if (e) {
      // no SELECT on the live table: rebuild its structure from the catalog, which needs no table rights
      const cols = await q(`select a.attname, format_type(a.atttypid, a.atttypmod) typ, a.attnotnull nn, pg_get_expr(d.adbin, d.adrelid) def, a.attgenerated gen
                              from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                             where a.attrelid = ('public.' || $1)::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`, [t]);
      const colSql = cols.map((r) => `"${r.attname}" ${r.typ}${r.gen === "s" && r.def ? ` generated always as (${r.def}) stored` : r.def ? ` default ${r.def}` : ""}${r.nn ? " not null" : ""}`);
      const cons = await q("select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid = ('public.' || $1)::regclass and contype in ('p','u','c')", [t]);
      e = await tryq(`create temp table ${t} (${[...colSql, ...cons.map((k) => `constraint "${k.conname}" ${k.d}`)].join(", ")})`);
      if (e) { report.fails.push(`copy of live table ${t}: ${e.message}`); continue; }
      for (const ix of await q("select pg_get_indexdef(i.indexrelid) d from pg_index i where i.indrelid = ('public.' || $1)::regclass and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)", [t])) {
        await tryq(ix.d.replace(/ ON (ONLY )?public\./i, " ON pg_temp."));
      }
    } else if (Number(live.reltuples) < 50000) {
      await tryq(`insert into pg_temp.${t} select * from public.${t}`); // the rows this role may read (RLS applies)
    }
    moveTables.add(t); report.copiedTables.push(t);
  }
  const movedTableAlt = [...moveTables].join("|") || "rh_none";
  await c.query(`create function pg_temp.rh_to_temp(s text) returns text language sql immutable as $f$
    select regexp_replace(regexp_replace(s, '(function|procedure)\\s+(public|private|pg_temp_[0-9]+)\\.', '\\1 pg_temp.', 'gi'),
                          '\\mpublic\\.(${movedTableAlt})\\M', 'pg_temp.\\1', 'gi') $f$`);

  // ── copy live functions the chain creates, patches or looks up ───────────────────────────────────
  await c.query("set local check_function_bodies = off"); // copies may reference each other in any order
  for (const fn of fnNames) {
    const defs = await q("select n.nspname, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.proname = $1 and p.prokind = 'f'", [fn]);
    for (const { nspname, d } of defs) {
      const def = rename(d.replace(new RegExp(`FUNCTION "?${nspname}"?\\."?${fn}"?\\(`, "i"), `FUNCTION pg_temp.${fn}(`));
      const e = await tryq(def);
      if (e) report.fails.push(`copy of live ${nspname}.${fn}: ${e.message}${e.position ? ` … at: ${def.slice(Math.max(0, e.position - 120), e.position + 60).replace(/\s+/g, " ")}` : ""}`); else report.copiedFns.push(`${nspname}.${fn}`);
    }
  }
  await c.query("set local check_function_bodies = on");

  // ── run the chain ─────────────────────────────────────────────────────────────────────────────────
  const split = (text) => {
    const out = []; let start = 0; let i = 0;
    while (i < text.length) {
      if (text.startsWith("--", i)) { const e = text.indexOf("\n", i); i = e < 0 ? text.length : e + 1; continue; }
      if (text[i] === "'") { i++; while (i < text.length) { if (text[i] === "'" && text[i + 1] === "'") { i += 2; continue; } if (text[i] === "'") break; i++; } i++; continue; }
      if (text[i] === "$") { const m = /^\$[A-Za-z_0-9]*\$/.exec(text.slice(i)); if (m) { const e = text.indexOf(m[0], i + m[0].length); i = e < 0 ? text.length : e + m[0].length; continue; } }
      if (text[i] === ";") { out.push(text.slice(start, i + 1)); start = i + 1; }
      i++;
    }
    if (text.slice(start).trim()) out.push(text.slice(start));
    return out.map((s) => s.trim()).filter((s) => s.replace(/--[^\n]*/g, "").trim());
  };
  const liveFn = async (name) => (await q("select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.proname = $1", [name])).length > 0;
  for (const f of files) {
    const stmts = split(rename(raw.get(f))).filter((st) => !/^(begin|start\s+transaction|commit|end|rollback|savepoint|release|abort)\b[^;]*;?$/i.test(noComments(st).trim()));
    let ok = 0;
    for (const s of stmts) {
      const e = await tryq(s);
      if (!e) { ok++; report.ran++; continue; }
      const head = noComments(s).trim().split(/\s+/).slice(0, 6).join(" ").toLowerCase();
      const fnDenied = /permission denied for function (\w+)/.exec(e.message);
      const ownerOnly = e.code === "42501" && (
        /^(grant|revoke|comment|alter (function|table|view|default)|create policy|drop policy|drop index|alter table \S+ (enable|force))/.test(head)
        || (fnDenied && !fnNames.has(fnDenied[1]) && (await liveFn(fnDenied[1]))));
      const line = `${f.slice(0, 14)} [${e.code}] ${e.message.slice(0, 220)}\n      ${noComments(s).replace(/\s+/g, " ").trim().slice(0, 240)}`;
      (ownerOnly ? report.needsOwner : report.fails).push(line);
    }
    console.log(`${f}: ${ok}/${stmts.length} statements ran`);
  }
} catch (e) { fatal = true; console.error("FATAL", e.message); }
finally {
  await c.query("rollback");
  // Guard: nothing the rehearsal made may survive. Checked across EVERY backend through the catalog.
  const left = (await c.query("select n.nspname, count(*)::int n from pg_class k join pg_namespace n on n.oid = k.relnamespace where n.nspname like 'pg_temp_%' and k.relname in ('cron_job', 'stage_dispositions', 'agent_leads', 'lead_queue', 'dispositions') group by 1")).rows;
  if (left.length) { console.error(`LEFTOVER rehearsal objects: ${JSON.stringify(left)} — run purge-temp.mjs`); fatal = true; }
  await c.end();
}

console.log(`\ncopied ${report.copiedTables.length} live tables, ${report.copiedFns.length} live functions into pg_temp; ${report.ran} statements ran`);
console.log(`\nNEEDS-OWNER (${report.needsOwner.length}) — skipped only because the rehearsal role owns nothing live:`);
for (const l of report.needsOwner) console.log(`  ${l}`);
console.log(`\nFAIL (${report.fails.length}):`);
for (const l of report.fails) console.log(`  ${l}`);
console.log(fatal || report.fails.length ? "\nREHEARSAL FAILED (rolled back)" : "\nREHEARSAL OK (rolled back)");
process.exitCode = fatal || report.fails.length ? 1 : 0;
