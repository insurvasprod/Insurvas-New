/**
 * Builds one ordered, atomic SQL bundle from the seven pending LA-2 migrations.
 *
 * Why this exists: the 2026-09-18 audit's first release gate is "promote and verify the missing
 * LA-2 migrations/RPC/trigger, with migration history reconciled". Every automated path to that is
 * closed in this environment — the app role is `tenant_app` with no CREATE, the Supabase MCP is
 * authenticated to a different organization, the CLI is not installed and holds no token. So the
 * deliverable is the thing a database owner can act on in one step, rather than seven files and a
 * set of instructions.
 *
 * What the bundle does differently from running the files one at a time:
 *
 *   1. ONE TRANSACTION. Checked first: none of the seven contains `create index concurrently`,
 *      `vacuum` or anything else that cannot run inside a transaction. A failure at file five
 *      therefore leaves the database exactly as it was, rather than five-sevenths migrated — which
 *      is the state that produced the 270-vs-327 history drift in the first place.
 *
 *   2. IT REGISTERS ITSELF. `supabase_migrations.schema_migrations` is what makes "applied" a fact
 *      rather than an assumption, and the audit found it 57 rows behind the checkout. Each file's
 *      version is inserted as part of the same transaction, so history and schema move together or
 *      not at all. `on conflict do nothing` keeps a re-run harmless.
 *
 *   3. IT PROVES ITSELF BEFORE COMMITTING. The tail asserts every object, function and trigger the
 *      seven files are supposed to create, and raises if any is missing. A bundle that runs to
 *      completion and commits is therefore evidence, not a claim — which is the distinction the
 *      whole audit turns on.
 *
 * Run: node scripts/build-la2-deployment.mjs
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, "..", "supabase", "migrations");
const outDir = join(here, "..", "supabase", "deploy");

// The seven the audit names, by version prefix. Listed explicitly rather than globbed: a glob would
// silently pick up an eighth file someone adds later and put unreviewed DDL into a bundle whose
// whole purpose is being reviewable.
const PENDING = [
  "20260917140000",
  "20260917141000",
  "20260917142000",
  "20260917143000",
  "20260917144000",
  "20260917145000",
  "20260917146000",
];

/** What must exist afterwards, asserted inside the transaction. */
const EXPECT_RELATIONS = [
  "tenant_campaign_scrub_rejections",
  "tenant_campaign_costs",
  "tenant_vendor_speed_to_lead",
];
const EXPECT_FUNCTIONS = ["record_campaign_scrub_rejections", "prevent_internal_dnc_removal"];
const EXPECT_TRIGGERS = [["tenant_do_not_call", "tenant_do_not_call_permanent"]];
/** Behaviour, not just presence — the audit's deep check reads function bodies, so assert those too. */
const EXPECT_BODIES = [
  ["import_agent_lead_batch", "insert\\s+into\\s+public\\.lead_queue", "import does not enqueue, so an imported list cannot be dialled"],
  ["import_agent_lead_batch", "20000", "the import batch cap is still 2000"],
];

const files = readdirSync(migrations).filter((n) => n.endsWith(".sql"));
const chosen = PENDING.map((version) => {
  const name = files.find((n) => n.startsWith(version));
  if (!name) throw new Error(`no migration file for version ${version}`);
  return { version, name, sql: readFileSync(join(migrations, name), "utf8") };
});

const stamp = new Date().toISOString().slice(0, 10);
const parts = [];

parts.push(`-- ============================================================================
-- LA-2 pending migrations — one atomic deployment
-- Generated ${stamp} by scripts/build-la2-deployment.mjs. Do not hand-edit; regenerate.
--
-- Seven migrations exist in supabase/migrations/ and none of them is applied. Verified against the
-- live catalog, not inferred from migration history:
--
--   tenant_campaign_scrub_rejections   MISSING      record_campaign_scrub_rejections   MISSING
--   tenant_campaign_costs              MISSING      prevent_internal_dnc_removal       MISSING
--   tenant_vendor_speed_to_lead        MISSING      tenant_do_not_call_permanent       MISSING
--   import_agent_lead_batch enqueues   no           import batch cap is 20000          no
--
-- WHAT THIS FIXES, in the order a reader will care about:
--
--   · An imported list cannot be dialled at all. \`serve_next_lead\` reads only \`lead_queue\`, and
--     nothing in the product ever writes a row to it for a CSV import. The dialer correctly reports
--     "nothing servable" and there is no way to tell that from an empty queue. (146000)
--   · Importing with a campaign selected fails at the commit. (140000)
--   · Cost per usable record, rejected/usable counts and speed-to-lead cannot be computed. (140000, 143000)
--   · An internal do-not-call entry can still be deleted. (142000)
--   · A lead dialled in every slot is never served again. (144000)
--
-- HOW TO RUN
--   Supabase dashboard → SQL editor → paste this whole file → Run.
--   Or:  psql "<direct connection string>" -f supabase/deploy/la-2-pending.sql
--
--   It is ONE transaction. If anything fails, nothing is applied and the error names the reason.
--   It is safe to run twice: every statement is create-or-replace / if-not-exists, and the history
--   rows use on-conflict-do-nothing.
--
--   Afterwards, prove it rather than assuming:  npm run verify:la2-deployment
--
-- WHAT IT DOES NOT DO
--   It does not reconcile the other ~50 rows of migration-history drift the audit found (270 live
--   records against 327 files). That needs the database owner to decide, file by file, whether each
--   unrecorded migration was applied-and-unregistered or never applied at all — and guessing in
--   either direction is worse than the drift. This bundle only makes these seven honest.
-- ============================================================================

begin;

-- A lock timeout so this cannot sit blocking writers indefinitely if something else holds a lock on
-- agent_leads or lead_queue. It replaces functions those tables' triggers depend on.
set local lock_timeout = '30s';
set local statement_timeout = '15min';
`);

for (const { name, sql } of chosen) {
  parts.push(`
-- ────────────────────────────────────────────────────────────────────────────
-- ${name}
-- ────────────────────────────────────────────────────────────────────────────
${sql.trimEnd()}
`);
}

parts.push(`
-- ────────────────────────────────────────────────────────────────────────────
-- Migration history, in the same transaction as the schema it describes.
-- ────────────────────────────────────────────────────────────────────────────
insert into supabase_migrations.schema_migrations (version, name)
values
${chosen.map(({ version, name }) => `  ('${version}', '${name.replace(/'/g, "''")}')`).join(",\n")}
on conflict (version) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- Prove it before committing. A bundle that commits is evidence; one that raises tells you which
-- file did not do what it claims, while the database is still untouched.
-- ────────────────────────────────────────────────────────────────────────────
do $deploy$
declare
  v_missing text[] := '{}';
  v_name text;
  v_body text;
begin
  foreach v_name in array array[${EXPECT_RELATIONS.map((r) => `'${r}'`).join(", ")}] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_name
    ) then v_missing := v_missing || ('relation ' || v_name); end if;
  end loop;

  foreach v_name in array array[${EXPECT_FUNCTIONS.map((f) => `'${f}'`).join(", ")}] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_name
    ) then v_missing := v_missing || ('function ' || v_name); end if;
  end loop;

${EXPECT_TRIGGERS.map(
  ([table, trigger]) => `  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
     where c.relname = '${table}' and tg.tgname = '${trigger}' and not tg.tgisinternal
  ) then v_missing := v_missing || 'trigger ${trigger}'::text; end if;`,
).join("\n")}

${EXPECT_BODIES.map(
  ([fn, pattern, why]) => `  select pg_get_functiondef(p.oid) into v_body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = '${fn}' order by p.oid desc limit 1;
  if v_body is null or v_body !~* '${pattern}' then
    v_missing := v_missing || '${why.replace(/'/g, "''")}'::text;
  end if;`,
).join("\n")}

  if array_length(v_missing, 1) > 0 then
    raise exception 'LA-2 deployment incomplete: %', array_to_string(v_missing, '; ');
  end if;

  raise notice 'LA-2 deployment verified: % migrations applied, all objects and behaviours present.', ${chosen.length};
end $deploy$;

commit;
`);

mkdirSync(outDir, { recursive: true });
const out = join(outDir, "la-2-pending.sql");
writeFileSync(out, parts.join("\n"), "utf8");
const lines = parts.join("\n").split("\n").length;
console.log(`wrote supabase/deploy/la-2-pending.sql — ${chosen.length} migrations, ${lines} lines`);
for (const { name } of chosen) console.log(`  · ${name}`);
