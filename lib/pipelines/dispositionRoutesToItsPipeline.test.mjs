// Run with: npm test
//
// A disposition routes the lead to a pipeline reserved for that outcome — "no answer" to the
// no-answer pipeline, "callback scheduled" to the callback one, and so on.
//
// ── What it used to do, and why that was worse than not having it ──────────────────────────────
//
// The mapping table, the route, the audit row and the settings screen all existed, and the stage
// picker has always offered stages from EVERY pipeline, labelled "pipeline · stage". So pointing a
// disposition at a dedicated pipeline was configurable, saved cleanly, and was recorded in the audit
// log. It just never happened, because the resolver was confined to the pipeline the lead was
// already in:
//
//   and ps.pipeline_id = v_item.pipeline_id
//
// No row matched, `coalesce(v_stage_id, v_item.stage_id)` fell through to the lead's current stage,
// and the lead did not move. **A setting that saves and has no effect** is worse than one that does
// not exist: the absence is discoverable, the silence is not.
//
// Three things are pinned here, and the second and third matter as much as the first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const bodies = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => [name, readFileSync(join(MIGRATIONS, name), "utf8")]);

/**
 * The migration that last touches the WIZARD's disposition resolver.
 *
 * Selected by the two things that only a migration modifying `complete_disposition` can have: it
 * names that function as the one it is patching, and it reads `stage_dispositions`.
 *
 * The first version of this matched any file containing the strings `stage_dispositions` and
 * `complete_disposition` anywhere. On 2026-09-23 a later migration for the DIALER's resolver —
 * `complete_existing_dial_disposition`, a different function — mentioned the wizard's by name in a
 * comment explaining how the two differ. That was enough to make this guard pick the wrong file and
 * report three failures about a function that had not changed. A selector that a comment can move
 * is not a selector.
 */
const router = bodies
  .filter(
    ([, body]) =>
      body.includes("stage_dispositions") &&
      (body.includes("proname = 'complete_disposition'") ||
        body.includes("create or replace function public.complete_disposition(")),
  )
  .pop();

test("a disposition may route a lead into a different pipeline", () => {
  assert.ok(router, "no migration wires stage_dispositions into complete_disposition");
  const [, body] = router;
  assert.match(
    body,
    /ps\.pipeline_id = v_item\.pipeline_id/,
    "this guard expects the migration that removes the same-pipeline filter to quote it; rewrite the guard",
  );
  // The filter must be quoted only as the thing being removed, never reinstated.
  assert.match(
    body,
    /Any pipeline: the dedicated pipeline reserved for this disposition/,
    "the resolver is confined to the lead's current pipeline again, so a mapping to a dedicated pipeline does nothing",
  );
});

test("the lead and its work item both follow the stage", () => {
  const [, body] = router;
  const moves = [...body.matchAll(/pipeline_id = coalesce\(/g)].length;
  assert.equal(
    moves,
    2,
    `expected both agent_leads and lead_queue to follow the stage into its pipeline, found ${moves}. ` +
      "A lead in pipeline A carrying a stage from pipeline B renders in no column on either board.",
  );
});

test("an unmapped disposition still leaves the lead where it is", () => {
  const [, body] = router;
  // The fallback is what makes this safe to apply to a tenant that has configured nothing. Losing it
  // would move every lead on every disposition, which is the opposite of opt-in routing.
  assert.match(
    body,
    /coalesce\(v_stage_id, v_item\.stage_id\)/,
    "the unmapped fallback is gone; every disposition would now move the lead",
  );
  // The destination is resolved from the stage that was just chosen, so the two cannot disagree.
  // Matched as two fragments rather than one span: the migration writes this as an E-string built
  // across several concatenated source lines, so `coalesce(` and the subselect are not adjacent in
  // the file even though they are adjacent in the SQL it emits.
  assert.match(
    body,
    /select ps\.pipeline_id from public\.tenant_pipeline_stages ps where ps\.id = v_stage_id/,
    "the destination pipeline is no longer derived from the resolved stage",
  );
});

test("the settings screen says the mapping can cross pipelines", () => {
  // The picker already offered every pipeline's stages while the runtime ignored them. The copy is
  // the only place a reader learns that pointing at another pipeline now does something.
  const settings = readFileSync(join(ROOT, "components", "app", "pipeline-settings.tsx"), "utf8");
  assert.match(settings, /\{allStages\.map/, "the stage picker no longer offers stages from every pipeline");
  assert.match(
    settings,
    /in any pipeline/i,
    "the mapping card no longer tells the reader the destination may be another pipeline",
  );
  assert.match(
    settings,
    /no mapping leaves the lead where it is/i,
    "the mapping card no longer states what an unmapped disposition does",
  );
});
