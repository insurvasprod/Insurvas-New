import "./lib/refuseProduction.mjs";
/**
 * LA-2 deployment gate. Does the live database contain what the checked-out LA-2 migrations say it
 * should?
 *
 * The 2026-09-18 audit's finding was not that the code was wrong — `npm test`, lint, typecheck and
 * build were all green — but that the shared database was 57 migrations behind the checkout, and
 * nothing in the repository turned that into a failing check. `check:triggers` and
 * `verify:rpc-contract` each caught one symptom (one missing trigger, one missing function) because
 * they happen to enumerate those object classes. Everything else was invisible.
 *
 * This asserts the whole contract the seven pending migrations define, including the two behaviours
 * that live inside function bodies and so cannot be found by enumerating objects:
 *
 *   · `import_agent_lead_batch` must write a `lead_queue` row. `serve_next_lead` reads ONLY
 *     `lead_queue`, so without this an imported list can never be dialled — and the dialer reports
 *     "nothing servable", which is indistinguishable from an empty queue.
 *   · the import batch cap must be 20,000, or `MAX_LEAD_IMPORT_ROWS` in `lib/agentTemplates/csv.ts`
 *     accepts a file the database then rejects after the user has waited for the upload.
 *
 * Read-only. It creates nothing, changes nothing, and needs only the `tenant_app` credentials in
 * `.env.local` — every read below is catalog introspection.
 *
 *   npm run verify:la2-deployment
 *
 * Exits 1 while anything is missing, so this is a release gate rather than a report. To apply the
 * migrations: `node scripts/build-la2-deployment.mjs`, then run `supabase/deploy/la-2-pending.sql`
 * as a user with DDL rights.
 */
import pg from "pg";
import process from "node:process";

if (!process.env.TENANT_DB_URL) {
  console.error("Missing TENANT_DB_URL. Run with --env-file=.env.local");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.TENANT_DB_URL,
  ssl: { rejectUnauthorized: false },
});

let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failures += 1;
  }
};

/** Relations the migrations create, and the migration that owns each. */
const RELATIONS = [
  ["tenant_campaign_scrub_rejections", "20260917140000", "the append-only scrub-rejection evidence ledger"],
  ["tenant_campaign_costs", "20260917140000", "cost per usable record, and the import commit reads it"],
  ["tenant_vendor_speed_to_lead", "20260917143000", "LA-2.5 median seconds from arrival to first dial"],
];

const FUNCTIONS = [
  ["record_campaign_scrub_rejections", "20260917140000", "the import commit calls it when a campaign is selected"],
  ["prevent_internal_dnc_removal", "20260917142000", "LA-2.3: an internal DNC entry is permanent"],
];

const TRIGGERS = [
  ["tenant_do_not_call", "tenant_do_not_call_permanent", "20260917142000", "enforces the above; without it a suppression row can be deleted"],
];

/** Columns a migration ADDS to an existing relation — invisible to a relation-level check. */
const COLUMNS = [
  ["tenant_vendor_rollup", "records_rejected", "20260917140000", "the vendors API selects it; its absence 500s /app/campaigns"],
  ["tenant_vendor_rollup", "records_usable", "20260917140000", ""],
  ["tenant_vendor_rollup", "cost_per_usable_record_cents", "20260917140000", ""],
];

/** Behaviour inside a live function body. `pg_get_functiondef` is the only honest source: several
 *  migrations on this project patch function bodies with `replace()` inside a DO block, so the
 *  repository's own source text is not evidence of what the database does. */
const BODIES = [
  ["import_agent_lead_batch", /insert\s+into\s+public\.lead_queue/i, "20260917146000", "an imported list cannot be dialled without this"],
  ["import_agent_lead_batch", /20000/, "20260917141000", "the 20,000-row cap the client already assumes"],
  ["serve_next_lead", /current_slot_for_state\([^)]*\)\s*=\s*l\.next_preferred_slot/i, "20260917144000", "tier-4 slot condition; without it a fully-dialled lead is never served again"],
  // Membership must resolve through `tenant_users`. `public.users` has no `tenant_id` column, and
  // 20260917141000/146000 both shipped a re-emitted body that reverted 20260914193000's fix. That
  // would have applied silently and raised 42703 on every import, so the gate checks the shape
  // rather than trusting that a later file did not paste over it.
  ["import_agent_lead_batch", /from public\.tenant_users tu/, "20260914193000", "the actor check reverted to users.tenant_id, which does not exist — every import raises 42703"],
];

try {
  await client.connect();

  const who = await client.query("select current_user, current_database()");
  console.log(`LA-2 deployment gate · ${who.rows[0].current_user}@${who.rows[0].current_database}\n`);

  console.log("Relations");
  for (const [name, owner, why] of RELATIONS) {
    const r = await client.query(
      `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = $1`,
      [name],
    );
    check(`${name}`, r.rowCount > 0, `${owner} not applied — ${why}`);
  }

  console.log("\nColumns added to existing relations");
  for (const [rel, col, owner, why] of COLUMNS) {
    const r = await client.query(
      `select 1 from pg_attribute a
        where a.attrelid = to_regclass('public.' || $1) and a.attname = $2
          and a.attnum > 0 and not a.attisdropped`,
      [rel, col],
    );
    check(`${rel}.${col}`, r.rowCount > 0, [owner + " not applied", why].filter(Boolean).join(" — "));
  }

  console.log("\nFunctions");
  for (const [name, owner, why] of FUNCTIONS) {
    const r = await client.query(
      `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`,
      [name],
    );
    check(`${name}()`, r.rowCount > 0, `${owner} not applied — ${why}`);
  }

  console.log("\nTriggers");
  for (const [table, trigger, owner, why] of TRIGGERS) {
    const r = await client.query(
      `select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
        where c.relname = $1 and tg.tgname = $2 and not tg.tgisinternal`,
      [table, trigger],
    );
    check(`${table} · ${trigger}`, r.rowCount > 0, `${owner} not applied — ${why}`);
  }

  console.log("\nBehaviour in live function bodies");
  for (const [fn, pattern, owner, why] of BODIES) {
    const r = await client.query(
      `select pg_get_functiondef(p.oid) as def
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1
        order by p.oid desc limit 1`,
      [fn],
    );
    const def = r.rows[0]?.def ?? null;
    check(
      `${fn} · ${String(pattern).slice(0, 44)}`,
      Boolean(def) && pattern.test(def),
      def ? `${owner} not applied — ${why}` : `${fn} does not exist at all`,
    );
  }

  // The consequence, stated as its own check so the report leads with the thing that matters rather
  // than leaving the reader to infer it from six object names.
  console.log("\nConsequence");
  const enqueues = await client.query(
    `select pg_get_functiondef(p.oid) ~* 'insert\\s+into\\s+public\\.lead_queue' as ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'import_agent_lead_batch'
      order by p.oid desc limit 1`,
  );
  check(
    "a CSV-imported lead can reach the dialer",
    enqueues.rows[0]?.ok === true,
    "import writes no lead_queue row and serve_next_lead reads only lead_queue",
  );
} catch (error) {
  console.error(`\nCould not complete the gate: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

console.log("");
if (failures === 0) {
  console.log("[32mLA-2 deployment gate passed — the live schema matches the checked-out migrations.[0m");
} else {
  console.log(
    `[31m${failures} check(s) failed.[0m The seven LA-2 migrations are not applied.\n` +
      "Build the bundle with `node scripts/build-la2-deployment.mjs` and run\n" +
      "`supabase/deploy/la-2-pending.sql` as a user with DDL rights, then re-run this gate.",
  );
  process.exitCode = 1;
}
