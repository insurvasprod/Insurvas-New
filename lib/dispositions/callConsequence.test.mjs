import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { dialConsequence, durationWords } from "./callConsequence.ts";

const stage = { name: "Not Interested", pipeline_name: "Closed" };
const make = (over) => ({ disposition_key: "custom_key", ends_call: false, next: { kind: "cadence", minutes: null }, mapped_stage: null, ...over });

test("durations read the way Settings writes them", () => {
  assert.equal(durationWords(20), "20 minutes");
  assert.equal(durationWords(60), "1 hour");
  assert.equal(durationWords(129600), "90 days");
});

test("each branch of complete_existing_dial_disposition has its own sentence", () => {
  assert.equal(dialConsequence(make({ disposition_key: "do_not_call", ends_call: true, next: { kind: "suppress", minutes: null } })).effect, "suppress");
  assert.equal(dialConsequence(make({ disposition_key: "callback_scheduled", ends_call: true, next: { kind: "callback", minutes: null } })).effect, "callback");
  const rest = dialConsequence(make({ ends_call: true, next: { kind: "rest", minutes: 129600 }, mapped_stage: stage }));
  assert.equal(rest.effect, "rest");
  assert.match(rest.line, /Rests the lead for 90 days/);
  assert.match(rest.line, /moves the lead to Not Interested in Closed/);
  // A rest with no period is closed, exactly as the SQL's `and v_next_minutes is not null` falls through.
  assert.equal(dialConsequence(make({ ends_call: true, next: { kind: "rest", minutes: null } })).effect, "close");
  assert.match(dialConsequence(make({ disposition_key: "wrong_number", ends_call: true, next: { kind: "close", minutes: null } })).line, /vendor credit claim/);
  const retry = dialConsequence(make({ next: { kind: "retry", minutes: 20 }, mapped_stage: stage }));
  assert.equal(retry.effect, "retry");
  assert.match(retry.line, /Back in the queue in 20 minutes/);
  assert.equal(retry.movesStage, false, "a retry never moves the lead's stage");
  assert.doesNotMatch(retry.preview, /The lead moves to/);
  assert.equal(dialConsequence(make({})).effect, "cadence");
});

test("a terminal outcome names the stage it moves to, or says it stays", () => {
  assert.equal(dialConsequence(make({ ends_call: true, next: { kind: "close", minutes: null }, mapped_stage: stage })).movesStage, true);
  assert.match(dialConsequence(make({ ends_call: true, next: { kind: "close", minutes: null } })).preview, /No stage is mapped to this outcome, so the lead stays in its stage/);
  assert.match(dialConsequence(make({ ends_call: true, next: { kind: "close", minutes: null }, needs_verification: true })).line, /needs verification complete/);
});

test("the sentences never promise a follow-up the settings do not configure", () => {
  for (const config of [make({}), make({ ends_call: true, next: { kind: "close", minutes: null } }), make({ next: { kind: "retry", minutes: 2880 } })]) {
    assert.doesNotMatch(dialConsequence(config).preview, /follow-up in two days/);
  }
  assert.match(dialConsequence(make({ next: { kind: "retry", minutes: 2880 } })).preview, /2 days/);
});

test("the SQL branch order this module mirrors is still the latest definition's", () => {
  const dir = join(process.cwd(), "supabase", "migrations");
  const latest = readdirSync(dir).sort().reverse().map((file) => readFileSync(join(dir, file), "utf8"))
    .find((sql) => /create or replace function public\.complete_existing_dial_disposition\(/.test(sql));
  assert.ok(latest, "complete_existing_dial_disposition is gone");
  const body = latest.slice(latest.indexOf("create or replace function public.complete_existing_dial_disposition("));
  const order = ["p_disposition = 'do_not_call'", "p_disposition = 'callback_scheduled'", "v_next_action = 'rest' and v_next_minutes is not null", "v_ends_call and p_disposition in ('wrong_number', 'disconnected')", "elsif v_ends_call then", "v_next_action = 'retry' and v_next_minutes is not null"];
  let at = 0;
  for (const marker of order) {
    const found = body.indexOf(marker, at);
    assert.ok(found > 0, `the dialer's branch "${marker}" moved or changed; revisit lib/dispositions/callConsequence.ts`);
    at = found;
  }
  assert.match(body, /v_new_state in \('closed', 'exhausted', 'working', 'nurture'\)/, "the terminal routing set changed");
});
