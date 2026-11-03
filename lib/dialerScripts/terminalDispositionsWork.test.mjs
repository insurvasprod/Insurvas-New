// Run with: npm test
//
// The dialer could record a no-answer and nothing else.
//
// `complete_existing_dial_disposition` assigns `v_sched` only in the cadence branch, and its final
// statement read `case when v_new_state = 'retry' then v_sched.due_at else null end`. The guard
// looks like it protects the read and does not: PL/pgSQL hands the whole expression to the SQL
// engine with `v_sched` as a parameter, so the record must have a tuple structure before the CASE
// is evaluated at all. A branch that is never taken still has to be describable.
//
// So every disposition that ENDS a call raised `55000 record "v_sched" is not assigned yet`, after
// the writes had happened — which rolled them back and left the lead in limbo. An agent could dial
// and could not record a sale. Hit live on 2026-09-23 as a 503 while dispositioning a Florida lead
// `not_interested`.
//
// The part worth pinning: this was ALREADY FIXED ONCE. `20260913402000` diagnosed it exactly and
// patched `complete_dial_disposition`. There are two functions, the live one is
// `complete_existing_dial_disposition`, and the rewrite in `20260917145000` carried the defect
// forward. A fix that names one function does not protect the other, and re-emitting a function
// body is how a previous fix gets quietly dropped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();

/**
 * The last migration that defines `name`, which is what the database actually runs.
 *
 * This repo fixes a function two ways, and a guard that understands only one of them lies. Some
 * migrations `create or replace` the whole body; others read `pg_get_functiondef` and patch it by
 * string replacement inside a DO block, because re-emitting 140 lines to change two is how the
 * other 138 get quietly dropped. `20260913402000` fixed `complete_dial_disposition` the second
 * way — the first version of this file only looked for the first way, found the original buggy
 * definition from `20260913350000`, and reported a function that is fine as broken.
 */
function latestDefinitionOf(name) {
  const needle = `create or replace function public.${name}(`;
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const text = readFileSync(join(dir, files[i]), "utf8");
    const start = text.indexOf(needle);
    if (start === -1) continue;
    const end = text.indexOf("$function$;", start);
    if (end === -1) continue;

    // Anything after this file that patches the same function is applied on top of it. Only the
    // patching migrations matter here, so a later file that merely mentions the name is ignored.
    const patches = files
      .slice(i + 1)
      .map((file) => ({ file, text: readFileSync(join(dir, file), "utf8") }))
      .filter((entry) => entry.text.includes(`proname = '${name}'`) && entry.text.includes("pg_get_functiondef"));

    return {
      file: files[i],
      body: text.slice(start, end),
      patches: patches.map((entry) => entry.file),
      patchText: patches.map((entry) => entry.text).join("\n"),
    };
  }
  return null;
}

/** True when the body already has the scalars, or a later migration patches them in. */
const hasScalars = (found) =>
  /v_due_at\s+timestamptz/.test(found.body) || /v_due_at/.test(found.patchText ?? "");

// Both disposition functions, so a fix to one cannot leave the other behind again.
for (const name of ["complete_dial_disposition", "complete_existing_dial_disposition"]) {
  test(`${name} does not read an unassigned record`, () => {
    const found = latestDefinitionOf(name);
    assert.ok(found, `${name} has no definition in supabase/migrations`);

    const unguarded =
      /v_sched\.due_at\s+else\s+null/.test(found.body) || /v_sched\.slot\s+else\s+null/.test(found.body);
    assert.ok(
      !unguarded || hasScalars(found),
      `${name} (last defined in ${found.file}${found.patches.length ? `, patched by ${found.patches.join(", ")}` : ", never patched"}) reads v_sched behind a CASE that does not protect it — every terminal disposition will raise 55000 and roll back the writes it already made`,
    );
  });

  test(`${name} returns scalars rather than the record`, () => {
    const found = latestDefinitionOf(name);
    assert.ok(
      hasScalars(found),
      `${name} has neither the v_due_at scalar in its body nor a migration that patches one in`,
    );
  });
}

test("dialer dispositions route to a dedicated pipeline, except retries", () => {
  // The wizard path routed and the dialer path did not, so the same disposition sent two leads to
  // two different places. Now both route.
  //
  // The list is asserted by what it must EXCLUDE rather than by its exact contents, because the
  // contents are a product decision that has already changed once: it started as 'closed' and
  // 'exhausted', and 'working' — the callback_scheduled state — was added on 2026-09-23. Pinning
  // the literal list meant this guard failed on a deliberate change instead of a regression.
  //
  // 'retry' is the one that must never be in it. That lead is going back into the queue for the
  // next attempt, and relocating it would take it off the board the dialer serves from — a worse
  // failure than not routing at all, and a silent one.
  const found = latestDefinitionOf("complete_existing_dial_disposition");
  assert.match(found.body, /stage_dispositions/, "the dialer no longer consults the disposition-to-stage map");

  // The `in` list that guards the lookup, whatever it currently says, must not admit a retry.
  const guard = /if v_new_state in \(([^)]*)\) then\s*\n\s*select ps\.id/.exec(found.body);
  assert.ok(guard, "the terminal-only guard around the stage lookup has gone");
  assert.doesNotMatch(
    guard[1],
    /'retry'/,
    "a retry disposition now moves pipeline; it would leave the dialer's own board between attempts",
  );

  // Both rows, or a board renders the lead in no column at all.
  assert.match(found.body, /stage_id = coalesce\(v_stage_id, stage_id\)/, "the work item no longer follows the lead");
  assert.match(found.body, /pipeline_id = coalesce\(v_stage_pipeline, pipeline_id\)/, "the work item keeps the old pipeline");
});

test("the live path keeps the behaviour earlier migrations paid for", () => {
  // Re-emitting a 140-line function body is exactly how the inbound-return branch or the
  // do-not-call write disappears without anything failing loudly.
  const found = latestDefinitionOf("complete_existing_dial_disposition");
  assert.match(found.body, /inbound_return_call/, "the inbound return call branch was lost in a rewrite");
  assert.match(found.body, /suppress_phone/, "the do-not-call suppression write was lost in a rewrite");
  assert.match(found.body, /DISCLOSURE_NOT_CONFIRMED/, "the disclosure gate was lost in a rewrite");
});
