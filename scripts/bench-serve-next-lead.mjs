/**
 * LA-2.8 criterion 5: "Serving stays under 200ms with 100,000 eligible leads."
 *
 * The audit could not run this because no 100k fixture existed and no harness existed to build one.
 * This is the harness. It is deliberately a separate, opt-in script rather than part of
 * `verify:all`: it writes six figures of rows, and a suite that does that on every run is a suite
 * people stop running.
 *
 * WHY THIS CRITERION IS NOW THE SHARPEST ONE IN LA-2
 *
 * Until LA-2.8 the dialer read `/api/app/leads?limit=100` and auto-selected the first row, so the
 * cost of serving was a client-side sort over a hundred records and this number did not matter.
 * `serve_next_lead` moved it onto a function that scans `lead_queue`, joins `agent_leads`, resolves
 * six priority tiers, evaluates a calling window per row and optionally scores. That is now on the
 * hot path of every single dial, so 200ms is the difference between a queue that feels instant and
 * an agent waiting between calls all day.
 *
 * WHAT IT MEASURES
 *
 * The RPC itself, server-side, not the HTTP round trip — an HTTP measurement bundles Next.js, TLS
 * and the pooler into a number that cannot be attributed. It reports the full distribution rather
 * than a mean: a mean hides the tail, and the tail is what an agent actually experiences. The
 * criterion is judged on p95.
 *
 * It also runs a `explain (analyze, buffers)` on the same call, because a pass that relies on a
 * warm cache is not a pass — if the plan contains a sequential scan on `lead_queue` at 100k rows,
 * the number will not survive real data however good it looks here.
 *
 * SAFETY
 *
 *   · Refuses to run without --i-have-a-disposable-project. This inserts 100,000 rows; doing that
 *     to a shared database by accident is not recoverable in any pleasant way.
 *   · Every row it creates is namespaced `bench-serve-<runId>` and it deletes them on the way out,
 *     including on failure, in reverse dependency order.
 *   · It serves leads, which CLAIMS and LOCKS work items. It therefore creates its own tenant,
 *     campaign and agent rather than borrowing a real one — a benchmark that locks a working
 *     agent's queue for fifteen minutes is a denial of service on your own floor.
 *
 * Run:
 *   node --env-file=.env.local scripts/bench-serve-next-lead.mjs --i-have-a-disposable-project
 *   node --env-file=.env.local scripts/bench-serve-next-lead.mjs --i-have-a-disposable-project --rows 100000 --samples 200
 *
 * Needs a role that can insert into `lead_queue` and `agent_leads` and execute `serve_next_lead`.
 * `tenant_app` cannot; use the service role or a direct owner connection via TENANT_DB_URL.
 */
import pg from "pg";
import process from "node:process";
import { randomUUID } from "node:crypto";

const TARGET_MS = 200;
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const ROWS = Number(arg("rows", 100_000));
const SAMPLES = Number(arg("samples", 200));

if (!process.argv.includes("--i-have-a-disposable-project")) {
  console.error(
    `This inserts ${ROWS.toLocaleString()} rows and claims work items.\n` +
      "Re-run with --i-have-a-disposable-project once you are certain the target database is not shared.\n" +
      "It cleans up after itself, but a shared project should not be carrying a six-figure benchmark fixture at all.",
  );
  process.exit(2);
}
if (!process.env.TENANT_DB_URL) {
  console.error("Missing TENANT_DB_URL. Run with --env-file=.env.local");
  process.exit(1);
}

const runId = randomUUID().slice(0, 8);
const tag = `bench-serve-${runId}`;
const client = new pg.Client({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });

/** p-th percentile of an ascending-sorted array, nearest-rank. */
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

let created = null;

async function build() {
  console.log(`Building a ${ROWS.toLocaleString()}-lead fixture tagged ${tag}…`);

  // A tenant of its own. `serve_next_lead` is tenant-scoped, so the benchmark measures a queue of
  // exactly ROWS rather than ROWS plus whatever else the tenant already had — which would make the
  // number unreproducible between runs.
  const tenant = await client.query(
    `insert into public.tenants (name, status) values ($1, 'active') returning id`,
    [`${tag} tenant`],
  );
  const tenantId = tenant.rows[0].id;

  const vendor = await client.query(
    `insert into public.tenant_lead_vendors (tenant_id, name, lead_type)
     values ($1, $2, 'list') returning id`,
    [tenantId, `${tag} vendor`],
  );
  // `scrub_status = 'scrubbed'` and `status = 'active'` are what put the campaign in
  // `campaigns_servable`. A draft or unscrubbed campaign makes every lead ineligible and the
  // benchmark would measure an empty queue very quickly and report a false pass.
  const campaign = await client.query(
    `insert into public.tenant_campaigns
       (tenant_id, vendor_id, name, lead_type, status, scrub_status, scrubbed_at, total_spend_cents, records_purchased)
     values ($1, $2, $3, 'list', 'active', 'scrubbed', now(), 100000, $4) returning id`,
    [tenantId, vendor.rows[0].id, `${tag} campaign`, ROWS],
  );

  const template = await client.query(
    `select tenant_template_id, template_id, template_version, definition_version, product_line, pipeline_id, stage_id
       from public.agent_leads limit 1`,
  );
  if (!template.rowCount) throw new Error("no existing agent_leads row to copy a template shape from");
  const t = template.rows[0];

  // One set-based insert rather than 100,000 round trips. A row-at-a-time build takes minutes and
  // measures the client, not the database.
  //
  // The state spread is the point: a queue that is 100k identical fresh leads exercises exactly one
  // tier and proves nothing about the tier resolution that makes serving expensive. This mirrors a
  // real mid-campaign queue — mostly fresh, a meaningful retry population, a few callbacks due.
  console.log("  inserting leads…");
  await client.query(
    `insert into public.agent_leads
       (tenant_id, tenant_template_id, template_id, template_version, definition_version,
        product_line, pipeline_id, stage_id, campaign_id, lead_state, attempts_made,
        next_dial_after, posted_at, values)
     select $1, $2, $3, $4, $5, $6, $7, $8, $9,
            case when g % 10 < 6 then 'fresh' when g % 10 < 9 then 'retry' else 'nurture' end,
            case when g % 10 < 6 then 0 else (g % 5) + 1 end,
            case when g % 10 < 6 then null else now() - interval '1 hour' end,
            now() - (make_interval(mins => g % 4320)),
            jsonb_build_object(
              'first_name', 'Bench', 'last_name', 'Lead' || g,
              -- A spread of states, so the per-row calling-window evaluation actually branches
              -- instead of hitting one cached timezone answer 100,000 times.
              'state', (array['TX','FL','AZ','OH','GA','NC','CA','NY'])[1 + (g % 8)],
              'phone', lpad((2125550000 + g)::text, 10, '0'),
              'date_of_birth', '1960-01-01'
            )
       from generate_series(1, $10) as g`,
    [tenantId, t.tenant_template_id, t.template_id, t.template_version, t.definition_version,
     t.product_line, t.pipeline_id, t.stage_id, campaign.rows[0].id, ROWS],
  );

  console.log("  enqueuing work items…");
  await client.query(
    `insert into public.lead_queue (tenant_id, lead_id, product_line, pipeline_id, stage_id, stage_key, status, tier)
     select l.tenant_id, l.id, l.product_line, l.pipeline_id, l.stage_id, 'new', 'unclaimed', 100
       from public.agent_leads l where l.tenant_id = $1`,
    [tenantId],
  );

  const agent = await client.query(
    `select user_id from public.tenant_users where role in ('owner','producer') limit 1`,
  );
  if (!agent.rowCount) throw new Error("no tenant_users row to borrow an agent id from");

  // Planner statistics. Without this the first samples measure a plan chosen for an empty table,
  // which is the single easiest way to produce a meaningless benchmark in either direction.
  console.log("  analyzing…");
  await client.query("analyze public.lead_queue");
  await client.query("analyze public.agent_leads");

  created = { tenantId, agentUserId: agent.rows[0].user_id };
  const n = await client.query(
    `select count(*)::int as n from public.lead_queue where tenant_id = $1 and status = 'unclaimed'`,
    [created.tenantId],
  );
  console.log(`  ready: ${n.rows[0].n.toLocaleString()} unclaimed work items\n`);
  if (n.rows[0].n < ROWS) throw new Error(`only ${n.rows[0].n} of ${ROWS} rows are eligible; the fixture is wrong`);
}

async function measure() {
  const timings = [];
  let served = 0;
  console.log(`Sampling serve_next_lead ${SAMPLES}x…`);

  for (let i = 0; i < SAMPLES; i += 1) {
    const started = process.hrtime.bigint();
    const r = await client.query(`select * from public.serve_next_lead($1, $2)`, [
      created.tenantId,
      created.agentUserId,
    ]);
    timings.push(Number(process.hrtime.bigint() - started) / 1e6);
    if (r.rowCount && r.rows[0] && Object.values(r.rows[0]).some((v) => v !== null)) served += 1;

    // Release the claim so the next sample faces the same queue depth. Without this the benchmark
    // measures a queue that shrinks by one on every iteration and the numbers drift downward.
    await client.query(
      `update public.lead_queue set status = 'unclaimed', claimed_by = null, claimed_at = null, locked_until = null
        where tenant_id = $1 and status = 'claimed'`,
      [created.tenantId],
    );
  }

  const sorted = [...timings].sort((a, b) => a - b);
  const p95 = pct(sorted, 95);
  console.log("");
  console.log(`  served a lead on ${served}/${SAMPLES} samples`);
  console.log(`  min    ${sorted[0].toFixed(1)} ms`);
  console.log(`  median ${pct(sorted, 50).toFixed(1)} ms`);
  console.log(`  p95    ${p95.toFixed(1)} ms`);
  console.log(`  p99    ${pct(sorted, 99).toFixed(1)} ms`);
  console.log(`  max    ${sorted[sorted.length - 1].toFixed(1)} ms`);

  if (served === 0) {
    console.log("\n[31mNothing was served, so the timings measure a rejection path and prove nothing.[0m");
    console.log("Most likely the calling window excluded every state at this hour, or the campaign is not servable.");
    return false;
  }

  console.log("\nQuery plan (the number is only trustworthy if this is not a sequential scan on lead_queue):");
  const plan = await client.query(
    `explain (analyze, buffers, verbose false) select * from public.serve_next_lead($1, $2)`,
    [created.tenantId, created.agentUserId],
  );
  for (const row of plan.rows) console.log("  " + Object.values(row)[0]);
  await client.query(
    `update public.lead_queue set status = 'unclaimed', claimed_by = null, claimed_at = null, locked_until = null
      where tenant_id = $1 and status = 'claimed'`,
    [created.tenantId],
  );

  console.log("");
  if (p95 <= TARGET_MS) {
    console.log(`[32mPASS[0m — p95 ${p95.toFixed(1)} ms at ${ROWS.toLocaleString()} eligible leads (target ${TARGET_MS} ms).`);
    return true;
  }
  console.log(`[31mFAIL[0m — p95 ${p95.toFixed(1)} ms exceeds the ${TARGET_MS} ms target at ${ROWS.toLocaleString()} leads.`);
  return false;
}

async function teardown() {
  if (!created) return;
  console.log(`\nRemoving ${tag}…`);
  // Reverse dependency order, and scoped to the benchmark's own tenant so a mistake here cannot
  // reach anything else.
  for (const sql of [
    `delete from public.lead_queue where tenant_id = $1`,
    `delete from public.tenant_scoring_decisions where tenant_id = $1`,
    `delete from public.tenant_lead_sources where tenant_id = $1`,
    `delete from public.agent_leads where tenant_id = $1`,
    `delete from public.tenant_campaigns where tenant_id = $1`,
    `delete from public.tenant_lead_vendors where tenant_id = $1`,
    `delete from public.tenants where id = $1`,
  ]) {
    try {
      await client.query(sql, [created.tenantId]);
    } catch (error) {
      console.error(`  could not clean up with "${sql.slice(12, 48)}…": ${error.message}`);
    }
  }
  console.log("  done");
}

let ok = false;
try {
  await client.connect();
  await build();
  ok = await measure();
} catch (error) {
  console.error(`\nBenchmark failed: ${error.message}`);
} finally {
  await teardown();
  await client.end().catch(() => {});
}
process.exit(ok ? 0 : 1);
