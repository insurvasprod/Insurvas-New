/**
 * LA-2.7 and LA-2.8, as amended by decisions 1 and 2 of "Sixteen Open Questions, Answered"
 * (2026-09-11, newer than every task page).
 *
 * Three defects are pinned here, and the first two masked each other:
 *
 *   1. Every call attempt was written with the literal slot `"late_morning"`, so the record of
 *      which slots a lead had failed in was always the same one value. Slot rotation could not
 *      work, because the evidence it reads was never true.
 *   2. The serving query admits a retry lead only when the current slot is one it has never been
 *      dialled in. With six slots and a ceiling of seven attempts, a lead tried in all six can
 *      never satisfy that again — it deadlocks in `retry` forever, never reaching attempt seven and
 *      never exhausting to nurture. Defect 1 hid this by ensuring the six slots never filled.
 *   3. `inbound_return_call` did not exist, so a customer ringing back had to be recorded with an
 *      outbound disposition — spending a cadence attempt and rewriting the retry schedule.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { dialerSource } from "../dialerScripts/dialerSource.mjs";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(MIGRATIONS).sort();

// The body is the function's own, from its `create or replace` to its closing `$function$;`: a
// migration may restate several serving functions together (20260925709000 restates
// serve_next_lead, serve_lead_by_id and both previews), and their text is not serve_next_lead's.
function latestDefining(pattern) {
  for (let index = files.length - 1; index >= 0; index--) {
    const text = readFileSync(join(MIGRATIONS, files[index]), "utf8");
    const match = pattern.exec(text);
    if (!match) continue;
    const end = text.indexOf("$function$;", match.index);
    return { name: files[index], body: end === -1 ? text.slice(match.index) : text.slice(match.index, end) };
  }
  return null;
}

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("an attempt records the slot it actually happened in", () => {
  const service = read("lib", "dialerScripts", "service.ts");
  const body = service.slice(service.indexOf("export async function startDialAttempt"));

  // The literal is the defect. `schedule_next_attempt` builds "slots this lead has failed in" from
  // `tenant_call_attempts.slot`, so a hardcoded value made every lead look as though it had only
  // ever been tried at one time of day — and LA-2.7 criterion 1 was then true of a history that
  // was not true.
  assert.doesNotMatch(body.slice(0, body.indexOf("\n}")), /slot: "late_morning"/,
    "the attempt slot must not be hardcoded");
  assert.match(service, /async function resolveAttemptSlot/);
  // The database owns the mapping, including that Saturday at 10am is the weekend slot rather than
  // late morning — which is precisely the gap rotation exists to close.
  assert.match(service, /rpc\("current_slot_for_state"/);
});

test("slot rotation falls back to the least recently used slot, deterministically", () => {
  const scheduler = latestDefining(/create or replace function public\.schedule_next_attempt/);
  assert.ok(scheduler);

  // Decision 2: "If every slot has already been used, take the least recently used slot rather than
  // blocking or waiting."
  assert.match(scheduler.body, /order by max\(ca\.attempted_at\) asc/);

  // The previous fallback took `v_tried[1]` from `array_agg(distinct ...)`, whose order is
  // unspecified — so it was neither least-recently-used nor stable between runs.
  assert.doesNotMatch(scheduler.body, /v_slot := v_tried\[1\]/);

  // A null slot in the array would make `not (s = any(v_tried))` evaluate to null for every
  // candidate and silently empty the unused set, turning rotation off tenant-wide with no error.
  assert.match(scheduler.body, /and ca\.slot is not null/);
});

test("the serving query can no longer deadlock when every slot has been used", () => {
  const serve = latestDefining(/create or replace function public\.serve_next_lead/);
  assert.ok(serve);

  // The fallback reads the slot the scheduler already chose. `next_preferred_slot` is only ever an
  // already-used slot in the scheduler's all-slots-used branch, so this admits the LRU attempt
  // without weakening the hard rule in the ordinary case.
  const matches = serve.body.match(
    /current_slot_for_state\(l\.values->>'state', v_now\) = l\.next_preferred_slot/g,
  );
  assert.ok(matches, "the retry tier has no fallback, so a lead tried in every slot deadlocks");
  // Both the scored path and the naive path, or a tenant with scoring enabled still deadlocks
  // whenever a serve draws the holdout.
  assert.equal(matches.length, 2, "the fallback must be in both serving paths");

  // The unused-slot branch must survive: it is the hard rule, and the fallback is only the escape.
  assert.match(serve.body, /not exists \(\s*select 1 from tenant_call_attempts ca/);
});

test("the delay is a floor, and the slot decides when the lead actually surfaces", () => {
  const serve = latestDefining(/create or replace function public\.serve_next_lead/);
  // Decision 2: "retry no sooner than the configured delay, at the next unused slot inside the
  // legal window." `next_dial_after <= v_now` is the floor; the slot condition is what holds the
  // lead back past it until a usable slot arrives. The worked example — due at 12:15pm in a slot
  // already used, actually served at 6:40pm — is this pair of conditions.
  assert.match(serve.body, /l\.next_dial_after <= v_now/);
});

test("an inbound return call records history without spending a cadence attempt", () => {
  const disposition = latestDefining(/create or replace function public\.complete_existing_dial_disposition/);
  assert.ok(disposition);
  assert.match(disposition.body, /inbound_return_call/);

  // The branch must return before the counter is touched. If the increment ever moves above it, an
  // inbound call silently spends one of the lead's seven outbound attempts and nothing fails
  // visibly — the cadence just gets shorter.
  const inboundAt = disposition.body.indexOf("if p_disposition = 'inbound_return_call'");
  const incrementAt = disposition.body.indexOf("attempts_made = coalesce(attempts_made, 0) + 1");
  assert.ok(inboundAt > 0 && incrementAt > 0);
  assert.ok(inboundAt < incrementAt, "the inbound branch must precede the attempt increment");

  // And it must not touch the queue: decision 1 says opening a lead through search does not change
  // its position. The inbound branch returns before `lead_queue` is written.
  const inboundBranch = disposition.body.slice(inboundAt, incrementAt);
  assert.doesNotMatch(inboundBranch, /update public\.lead_queue/);
  assert.doesNotMatch(inboundBranch, /schedule_next_attempt/);

  // It returns the cadence exactly as it already stood, rather than nulls, so the caller cannot
  // mistake "unchanged" for "cleared".
  assert.match(inboundBranch, /v_lead\.next_dial_after, v_lead\.next_preferred_slot/);
});

test("an inbound return call needs no claimed work item, and everything else still does", () => {
  const disposition = latestDefining(/create or replace function public\.complete_existing_dial_disposition/);
  assert.match(
    disposition.body,
    /if v_attempt\.work_item_id is null and p_disposition <> 'inbound_return_call' then\s*\n\s*raise exception 'CALL_ATTEMPT_WORK_ITEM_MISSING'/,
  );

  const service = read("lib", "dialerScripts", "service.ts");
  // The claim check is what made the disposition unreachable from the search screen: search
  // correctly does not claim, so there was never a work item to satisfy it.
  assert.match(service, /if \(!queue\.data && !input\.inbound\) throw new DialerWorkflowError\(409/);
});

test("the search path offers only the inbound disposition, and says why", () => {
  const workspace = dialerSource();
  // Offering the outbound vocabulary on a search-opened lead is how the cadence gets corrupted, so
  // the two lists are separate rather than merged.
  // Since 20260929200000 both come from the tenant's dispositions (M1 LA-1.12-4): the outbound
  // buttons are the rows WITH a dialer position, and the inbound return call is seeded without one.
  assert.match(workspace, /INBOUND_RETURN_CALL/);
  assert.doesNotMatch(workspace, /"inbound_return_call"/, "the workspace must not hard-code the inbound key");
  const outcomes = read("lib", "dialerScripts", "outcomes.ts");
  const start = outcomes.indexOf("FALLBACK_DIALER_OUTCOMES: readonly");
  assert.doesNotMatch(outcomes.slice(start, outcomes.indexOf("];", start)), /inbound_return_call/, "the inbound disposition must not appear in the outbound button list");
  const seed = read("supabase", "migrations", "20260929200000_dialer_outcomes_are_tenant_dispositions.sql");
  assert.match(seed, /\(p_tenant_id, 'inbound_return_call', 'Inbound return call', false, 'completed', 140, 'cadence', null\)/, "the seeded inbound row must carry no dialer position");
  // The search path is where the customer who rang back is found (2026-09-24: it was keyed on
  // read-only access, which can write nothing, so the inbound call could never be logged).
  assert.match(workspace, /const outcomes: DialerOutcome\[\] = searchMode \? \(inboundOutcome \? \[inboundOutcome\] : \[\]\) : dispositions;/);
  // Said where the decision is made, not in a tooltip nobody opens.
  assert.match(workspace, /does not use one of this lead/);
});

test("the queue is still served and never browsed for progression", () => {
  const serve = latestDefining(/create or replace function public\.serve_next_lead/);
  // LA-2.8's core rule survives all of the above: the serve still claims atomically and still
  // applies every eligibility filter server-side. Decision 1 widened what search may READ; it
  // changed nothing about how the queue advances.
  assert.match(serve.body, /update lead_queue q\s*\n\s*set status = 'claimed'/);
  assert.match(serve.body, /where q\.id = v_qid and q\.status = 'unclaimed'/);
  assert.match(serve.body, /is_phone_suppressed\(/);
  assert.match(serve.body, /tenant_can_dial_now\(/);
  // An abandoned lock returns the lead to the pool — LA-2.8 criterion 3, and the thing most at
  // risk from a wholesale function rewrite.
  assert.match(serve.body, /set status = 'unclaimed', claimed_by = null/);
});

test("an imported lead gets a work item, or the dialer can never serve it", () => {
  // Found in the browser pass, not by reading: a four-row CSV imported cleanly and the dialer then
  // said "Nothing servable" with both leads sitting in `agent_leads`.
  //
  // `serve_next_lead` reads `from lead_queue q join agent_leads l on l.id = q.lead_id`. The queue is
  // the only thing it looks at, so a lead with no work item is invisible to every priority tier, to
  // scoring, to slot rotation and to the mixing weights. Verified against the live database at the
  // time: zero functions inserted into `lead_queue`, and no trigger on `agent_leads` did either.
  const serve = latestDefining(/create or replace function public\.serve_next_lead/);
  assert.ok(serve, "no migration defines serve_next_lead");
  assert.match(serve.body, /from\s+lead_queue\s+q/, "serving no longer reads lead_queue — revisit this test");

  const importer = latestDefining(/create or replace function public\.import_agent_lead_batch/);
  assert.ok(importer, "no migration defines import_agent_lead_batch");
  assert.match(
    importer.body,
    /insert\s+into\s+public\.lead_queue/,
    "import_agent_lead_batch does not enqueue, so an imported list cannot be dialled",
  );

  // In the same function as the lead insert, not in TypeScript after the RPC. The review screen
  // promises "all of it or none of it", and a second round trip after the commit would make
  // "leads written, queue rows missing" a reachable state with nothing to roll back to.
  const service = read("lib", "agentTemplates", "service.ts");
  const importer_ts = service.slice(service.indexOf("export async function importAgentLeads"));
  const body = importer_ts.slice(0, importer_ts.indexOf("\nexport async function"));
  assert.doesNotMatch(
    body.replace(/\/\/[^\n]*/g, ""),
    /from\("lead_queue"\)[\s\S]{0,40}\.insert/,
    "the enqueue belongs inside the transaction, not in a follow-up write",
  );

  // A lead with ANY queue history is not given a new work item by turning up in another file —
  // live or settled. The earlier guard only skipped a LIVE work item, so a person who had been
  // dialled, dispositioned and closed went straight back into the dialer on re-import. Putting a
  // worked lead back in front of an agent is the recycling path's decision (LA-2.20), with its own
  // rules. (Changed deliberately with 20260924330100.)
  assert.doesNotMatch(
    importer.body,
    /status not in \('completed', 'closed', 'dropped', 'expired'\)/,
    "the importer reopens leads whose work items are settled",
  );
  assert.match(
    importer.body,
    /if not exists \(\s*select 1 from public\.lead_queue\s+where tenant_id = p_tenant_id\s+and lead_id = v_lead_id\s*\) then/,
    "the importer no longer checks for any queue history before enqueueing",
  );
  // The campaign is still attributed to a person who is not re-queued.
  assert.match(importer.body, /perform public\.import_agent_lead_source\(/);
});
