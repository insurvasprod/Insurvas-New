/**
 * LA-2.9 and LA-2.8's central rule, pinned.
 *
 * The finding this file exists for: `serve_next_lead` had been correct and deployed for weeks and
 * **nothing called it**. Of the 152 RPCs the application invokes, it was not one — and neither were
 * `score_lead` nor `next_campaign_for_serving`. The dialer read `/api/app/leads?limit=100` and let
 * the agent pick a row.
 *
 * LA-2.8 says why that is the one thing that must not happen:
 *
 *   "He does not pick from a list. The system decides, he dials. That is what makes cadence,
 *    scoring and window enforcement mean anything — the moment he can browse, all three become
 *    suggestions."
 *
 * Everything downstream followed. The priority tiers never ran, so a real-time lead could not jump
 * the queue. The cadence timer and slot rotation were written on every disposition and read by
 * nobody. Two agents could open the same lead, because the atomic claim was never executed.
 * Campaign mixing weights decided nothing. Each of those was implemented, tested, and inert.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { rolesWith } from "../tenantAuth/permissions.ts";
import { dialerSource } from "./dialerSource.mjs";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("the application actually calls the serving function", () => {
  const service = read("lib", "dialerScripts", "service.ts");
  assert.match(service, /rpc\("serve_next_lead"/, "nothing calls serve_next_lead");
  assert.match(service, /export async function serveNextLead/);

  // And there is a route to reach it from.
  const route = read("app", "api", "app", "dialer", "next", "route.ts");
  assert.match(route, /serveNextLead/);

  // POST, not GET. The serve claims the work item and locks it for fifteen minutes, so a
  // prefetchable GET would take leads out of circulation and hand two agents the same one.
  assert.match(route, /export async function POST\(/);
  assert.doesNotMatch(route, /export async function GET\(/);
});

test("every route that serves a lead is registered in the policy map", () => {
  const policy = read("lib", "entitlements", "agentApiPolicy.ts");
  // The money-boundary drift guard fails on an unregistered route, so this is belt and braces —
  // but an unregistered serving route would be a role gate nobody declared.
  assert.match(policy, /app\/api\/app\/dialer\/next\/route\.ts/);
  // The roles are compared to the permission map rather than spelled out again. They were spelled
  // out here, and that is how the drift survived: permissions.ts granted a setter dialer.use, the
  // route admitted owners and producers only, and this test agreed with the route because it was
  // written from the route. Comparing the declared row to the map means the two can no longer
  // disagree quietly in either direction.
  const declared = policy.match(
    /dialer\/next\/route\.ts", featureKey: "outbound_dialing", allowedRoles: \[([^\]]*)\]/,
  );
  assert.ok(declared, "the serving route has no declared role list in the policy map");
  const roles = [...declared[1].matchAll(/"([a-z]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(
    roles,
    [...rolesWith("dialer.use")].sort(),
    "the serving route and permissions.ts disagree about who may dial",
  );
});

test("an empty queue explains itself, and the wording comes from the server", () => {
  const route = read("app", "api", "app", "dialer", "next", "route.ts");
  // LA-2.8: "When nothing is servable, say why ... This is normal early and late in the day." The
  // sentence lives in display.ts since the route started naming held-back campaigns (LA-2.3).
  assert.match(read("lib", "dialerScripts", "display.ts"), /outside its local window, waiting on a retry timer, or already worked/);
  // LA-2.8-6: the reason is worked out for THIS agent (their licences, windows and timers), and the
  // read-only queue list gives the same diagnosis when it is empty.
  assert.match(route, /emptyQueueReason\(auth\.context\.tenantId, auth\.context\.userId\)/);
  assert.match(read("lib", "dialerScripts", "service.ts"), /export async function diagnoseEmptyQueue\(tenantId: string, agentId\?: string\)/);
  assert.match(read("app", "api", "app", "dialer", "queue", "route.ts"), /diagnoseEmptyQueue\(auth\.context\.tenantId, auth\.context\.userId\)/);
  // 200 with served: null, not a 404. An empty queue is a working system, and a 404 would make the
  // screen treat it as broken.
  assert.doesNotMatch(route, /status: 404/);
  assert.match(route, /served: null/);

  const workspace = dialerSource();
  assert.match(workspace, /emptyReason/);
});

test("the dialer no longer picks the first row of a list as the next call", () => {
  const workspace = dialerSource();
  // `setSelectedId(loaded[0].id)` was the browse rule in its purest form: whichever lead happened
  // to sort first became the next call, whatever the cadence, the window or the score said.
  assert.doesNotMatch(workspace, /if \(loaded\[0\]\) setSelectedId\(loaded\[0\]\.id\)/);
  assert.match(workspace, /fetch\("\/api\/app\/dialer\/next", \{ method: "POST" \}\)/);
  // And the table read that made browsing dangerous is gone for good: nothing on this screen lists
  // leads straight out of /api/app/leads, which knows nothing of windows, lists or claims.
  assert.doesNotMatch(workspace, /\/api\/app\/leads\?limit/);
});

// ── RULE CHANGE, deliberate (user decision 2026-09-24) ────────────────────────────────────────
//
// LA-2.8's "he does not pick from a list" is reversed: the board's Priority queue is clickable, so
// an agent chooses whom to call. What LA-2.8 actually protected survives, and these tests are that
// protection restated for a pickable list: the list comes from the server with serving's own
// predicates, and a pick is a SERVE of that lead — same gates, same lock — never a client-side
// selection of a row.
test("the queue list is the server's, and a pick goes through the server's serve", () => {
  const workspace = dialerSource();
  assert.match(workspace, /fetch\(`\/api\/app\/dialer\/queue\?priority=\$\{queueFilter\}`/, "the list is not the server's preview");
  assert.match(workspace, /fetch\("\/api\/app\/dialer\/pick", \{ method: "POST"/, "a pick does not go through the server");
  // A queue row claims through pickLead; only search results (decision 1's lookup) open a lead
  // without serving it.
  assert.match(workspace, /onClick=\{\(\) => void pickLead\(row\)\}/);
  assert.doesNotMatch(workspace, /onClick=\{\(\) => selectLead\(row\./, "a queue row opens its lead without serving it");
  // A refused pick shows the server's reason in the row.
  assert.match(workspace, /pickRefusals\[row\.workItemId\]/);

  const pick = read("app", "api", "app", "dialer", "pick", "route.ts");
  assert.match(pick, /export async function POST\(/);
  assert.doesNotMatch(pick, /export async function GET\(/);
  assert.match(pick, /serveLeadById/);
  const service = read("lib", "dialerScripts", "service.ts");
  assert.match(service, /rpc\("serve_lead_by_id"/);
  // The same TypeScript licence re-check serveNextLead applies, with the same hand-back.
  const body = service.slice(service.indexOf("export async function serveLeadById"));
  assert.match(body.slice(0, 2500), /licenceFor\(licence, state\)/);
  assert.match(body.slice(0, 2500), /returnRefusedLead\(db, input\.tenantId, input\.agentId, row\)/);

  const queue = read("app", "api", "app", "dialer", "queue", "route.ts");
  assert.match(queue, /export async function GET\(/);
  assert.match(service, /rpc\("dialer_queue_preview"/);
});

test("the pick and the preview carry every predicate serve_next_lead applies, and the lock", () => {
  const files = readdirSync(join(process.cwd(), "supabase", "migrations")).sort();
  const latest = (name) => {
    for (let index = files.length - 1; index >= 0; index--) {
      const text = readFileSync(join(process.cwd(), "supabase", "migrations", files[index]), "utf8");
      const start = text.indexOf(`create or replace function public.${name}(`);
      if (start >= 0) return text.slice(start, text.indexOf("$function$;", text.indexOf("$function$", start) + 10));
    }
    return null;
  };
  const serve = latest("serve_next_lead");
  const pick = latest("serve_lead_by_id");
  const preview = latest("dialer_queue_preview");
  assert.ok(serve && pick && preview, "a serving function is missing");
  for (const [name, body] of [["serve_next_lead", serve], ["serve_lead_by_id", pick], ["dialer_queue_preview", preview]]) {
    for (const gate of [/is_phone_suppressed\(p_tenant_id/, /tenant_can_dial_now\(p_tenant_id/, /agent_may_work_state\(p_tenant_id, p_agent_user_id/, /campaigns_servable/, /lead_state <> 'exhausted'/, /lead_queue_assignee\(p_tenant_id/]) {
      assert.match(body, gate, `${name} is missing ${gate}`);
    }
  }
  // The pick locks the row and re-checks it the way the serve does, so two agents cannot hold one lead.
  assert.match(pick, /for update/);
  assert.match(pick, /where q\.id = v_q\.id and q\.status = 'unclaimed'/);
  // The preview is read-only and bounded.
  assert.match(preview, /\bstable\b/);
  assert.doesNotMatch(preview, /\b(insert into|update lead_queue|update agent_leads|delete from)\b/);
  assert.match(preview, /limit v_limit/);
  assert.match(preview, /limit v_cap \+ 1/);
});

test("High, Medium and Low come from the tier, never the score", async () => {
  const { priorityForTier, PRIORITY_TIERS } = await import("./display.ts");
  assert.equal(priorityForTier("realtime"), "High");
  assert.equal(priorityForTier("callback"), "High");
  assert.equal(priorityForTier("appointment"), "High");
  assert.equal(priorityForTier("retry"), "Medium");
  assert.equal(priorityForTier("fresh"), "Low");
  assert.equal(priorityForTier("nurture"), "Low");
  assert.deepEqual(PRIORITY_TIERS, { High: [1, 2, 3], Medium: [4], Low: [5, 6] });
  const workspace = dialerSource();
  assert.doesNotMatch(workspace, /\.score\b/, "the workspace reads a score");
});

test("Serve next includes the agent's own assigned leads, and never another agent's", () => {
  const files = readdirSync(join(process.cwd(), "supabase", "migrations")).sort();
  let serve = null;
  for (let index = files.length - 1; index >= 0 && !serve; index--) {
    const text = readFileSync(join(process.cwd(), "supabase", "migrations", files[index]), "utf8");
    if (/create or replace function public\.serve_next_lead\(/.test(text)) serve = text;
  }
  // 20260925709000: the holder of a due callback handed back to its agent is asked first, then the
  // assignment log — still this agent only, never another agent's.
  assert.match(serve, /q\.owner_user_id = p_agent_user_id\s*\n\s*and q\.claimed_by = p_agent_user_id\s*\n\s*and q\.locked_until is null\s*\n\s*and q\.disposition is null\s*\n\s*and coalesce\(public\.callback_work_item_holder\(p_tenant_id, q\.id\), lead_queue_assignee\(p_tenant_id, q\.id\)\) = p_agent_user_id/);
  // An abandoned lock on an assigned lead goes back to its assignee, not to the pool, and the lead
  // itself is restored (20260913401000's fix, which 20260917144000 had dropped).
  assert.match(serve, /kept as \(/);
  assert.match(serve, /set lead_state = case when coalesce\(l\.attempts_made, 0\) = 0 then 'fresh' else 'retry' end/);
});

test("the next lead appears immediately after a disposition", () => {
  const workspace = dialerSource();
  const body = workspace.slice(workspace.indexOf("async function disposition("));
  // The task's own words: "After a disposition — the next lead appears immediately." Reloading the
  // same panel left the agent looking at a lead they had just finished with.
  // It must be serveNextNow, not serveNext: serveNext refuses while a call is open, and in this
  // closure the call resetCall() just closed still reads as open — so it served nothing.
  // (2200: the "Interested – start application" branch, LA-2.9-3, sits above it now.)
  const head = body.slice(0, body.indexOf("\n  }\n") + 4);
  assert.ok(head.length < 2600, "disposition() is longer than expected; the slice below would miss it");
  assert.match(head, /await serveNextNow\(\)/);
  assert.doesNotMatch(head, /await serveNext\(\)/);
});

test("the served lead shows its tier and the server's reason, and not its score", () => {
  const workspace = dialerSource();
  assert.match(workspace, /served\.selectionReason/);
  assert.match(workspace, /served\.tierName/);
  // LA-2.13's own warning is that a number nobody can explain is worse than no number, which is
  // why the reason is rendered and the raw score is not.
  assert.doesNotMatch(workspace, /served\.score/);
  // The lock is visible, because LA-2.8 promises an abandoned lead returns to the pool and an agent
  // who does not know they hold a lock cannot reason about that.
  assert.match(workspace, /served\.lockedUntil/);
});

test("the whole loop is operable from the keyboard", () => {
  const workspace = dialerSource();
  // LA-2.9 criterion 6: "Keyboard-only operation for the whole loop — dial, disposition, next."
  // Every control was already a real button, so tab-and-enter worked; what did not exist was a
  // loop an agent can run all day.
  assert.match(workspace, /window\.addEventListener\("keydown", onKey\)/);
  assert.match(workspace, /window\.removeEventListener\("keydown", onKey\)/);
  assert.match(workspace, /key === "n"/);
  assert.match(workspace, /key === "d"/);
  // LA-2.9-9: Click to call and "I read this disclosure" have keys too, and the tenth outcome is 0,
  // so no step of the loop needs the mouse.
  assert.match(workspace, /if \(key === "c"\) \{ if \(!attempt && !working && callReady\) \{ event\.preventDefault\(\); void prepareAttempt\(searchMode\); \}/);
  assert.match(workspace, /if \(key === "r"\) \{ if \(attempt && !confirmed && !working && !panel\?\.disclosure\.blocking\) \{ event\.preventDefault\(\); void confirmRead\(\); \}/);
  assert.match(workspace, /const index = outcomeIndexForKey\(event\.key\);/);
  assert.match(workspace, /index !== null && index < dispositions\.length/);
  // Escape leaves a pending confirmation, and the confirm button takes the focus so Enter records it.
  assert.match(workspace, /event\.key === "Escape" && \(pendingCallback \|\| pendingDnc \|\| pendingReturn\)/);
  assert.equal((workspace.match(/<Button type="button" autoFocus disabled=\{working\}/g) ?? []).length, 2, "Do not call and the returnable confirmations take the focus");

  // A shortcut that fires while somebody is typing would replace a search query with a served lead
  // mid-word.
  assert.match(workspace, /target\.tagName === "INPUT"/);
  assert.match(workspace, /target\.isContentEditable/);

  // Discoverable, or it may as well not exist. The count follows the rendered set, capped at the
  // nine digit keys (2026-09-25: ten outcomes for an owner or producer with Wrong number and
  // Disconnected, nine for a setter, who is not offered Application).
  assert.match(workspace, /Keys 1–\$\{Math\.min\(9, dispositions\.length\)\}\$\{dispositions\.length >= 10 \? " and 0" : ""\} choose a disposition/);
  assert.match(workspace, /Keys: C calls, R records the disclosure, D starts the call\./);
});

test("no metric labelled talk time is displayed anywhere", () => {
  // LA-2.9 is explicit: the existing `call_duration_seconds` measures how long the lead card was
  // open, not how long anyone talked, so every talk-time figure was wrong. The task asks for the
  // field to be renamed or not displayed.
  const activity = read("lib", "activityLog", "service.ts");
  assert.match(activity, /card_open_seconds/);
  assert.doesNotMatch(activity, /talk_time|talkTime/i);
});

test("a disposition with no click is still flagged", () => {
  const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(MIGRATIONS).sort();
  let found = null;
  for (let index = files.length - 1; index >= 0; index--) {
    const body = readFileSync(join(MIGRATIONS, files[index]), "utf8");
    if (/zero_click_disposition/.test(body)) { found = body; break; }
  }
  assert.ok(found, "the zero-click integrity check is gone");
  // LA-2.9: "An agent can record an outcome for a call that never happened ... keep it, because it
  // is the only integrity check available without telephony."
  assert.match(found, /a\.disposition is not null and a\.clicked_at is null/);
});

test("the seam for a telephony provider is still open", () => {
  const service = read("lib", "dialerScripts", "service.ts");
  // LA-2.9: "Leave the seam: a call_attempt record with a nullable provider_call_id, so a provider
  // drops in later without a rewrite."
  assert.match(service, /provider_call_id/);
});

test("the callback window check is patched into the live booking paths, not just written", () => {
  const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(MIGRATIONS).sort();
  let guard = null;
  for (let index = files.length - 1; index >= 0; index--) {
    const body = readFileSync(join(MIGRATIONS, files[index]), "utf8");
    if (/create or replace function public\.assert_callback_in_window/.test(body)) { guard = body; break; }
  }
  assert.ok(guard, "LA-2.10 criterion 2 has no calling-window guard");

  // The window is evaluated AT THE BOOKED INSTANT, not at the moment of booking. "Thursday 2pm"
  // must be legal on Thursday at 2pm in the customer's zone; whether it is legal right now would
  // reject most evening callbacks booked in the morning.
  assert.match(guard, /tenant_can_dial_now\(p_tenant_id, v_state, v_campaign, p_scheduled_at\)/);

  // This migration installs the check by REWRITING the live function bodies rather than by
  // re-emitting them, which is why grepping the migrations that define those functions finds
  // nothing. The assertion is that both booking paths end up carrying it — the same thing the
  // migration's own DO block checks against the live catalogue.
  assert.match(guard, /assert_callback_in_window/);
  assert.match(guard, /complete_disposition_with_callback/);
  assert.match(guard, /reschedule_callback/);
  assert.match(guard, /the window check did not reach both booking paths/);

  // And the past check it sits beside must survive, or a callback for last March becomes bookable
  // inside the window with nothing objecting.
  assert.match(guard, /CALLBACK_DATE_PAST/);
});
