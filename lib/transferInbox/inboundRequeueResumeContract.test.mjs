/**
 * Module 1 inbound transfers, the 2026-09-25 migrations (20260925709850 / 709860 / 709870) and the
 * app side that uses them. Source-level contracts, the house style: each pins the behaviour a
 * tracker line needs, and the reconciliation with the live database made on 2026-09-29.
 *
 *   LA-1.10-2   inbox age from the date of birth
 *   LA-1.10-8   a dropped call goes back in the queue
 *   LA-1.11-6   a re-claim resumes the same verification session, and says so (`resumed`)
 *   LA-1.12-10  an inbound disposition writes stage history ('inbound') and the activity row
 *   LA-1.13-2   the buffer agent on the deal row and in the report; the composed initial quote
 *   LA-1.14-7   the partner's Connected card once per claim, a re-claim included
 *   LA-1.14-9   unassign and end buffer involvement are different acts, both confirmed first
 *   LA-1.14-10  a caller's language gates who may claim, with a clear refusal
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));
const foundations = await read("supabase/migrations/20260925709850_inbound_transfer_foundations.sql");
const requeue = await read("supabase/migrations/20260925709860_inbound_requeue_resume_and_buffer_involvement.sql");
const history = await read("supabase/migrations/20260925709870_inbound_disposition_history_and_deal_buffer.sql");
const claimRoute = await read("app/api/app/inbound/claim/route.ts");
const claimNextRoute = await read("app/api/app/inbound/claim-next/route.ts");
const releaseRoute = await read("app/api/app/inbound/release/route.ts");
const release = await read("lib/transferInbox/release.ts");
const service = await read("lib/transferInbox/service.ts");
const inbox = await read("components/app/transfer-inbox.tsx");
const floor = await read("components/app/agent-floor.tsx");
const leadPage = await read("components/app/lead-detail-workspace.tsx");
const leadService = await read("lib/leadWorkspace/service.ts");
const policy = await read("lib/entitlements/agentApiPolicy.ts");
const money = await read("lib/tenantAuth/moneyRoutes.test.mjs");
const stageSync = await read("lib/applications/stageSync.ts");
const pipelineViews = await read("components/app/pipeline-views.tsx");

const fn = (sql, name) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is not defined`);
  return sql.slice(start, sql.indexOf("$function$;", start));
};

/* ── the migrations ─────────────────────────────────────────────────────── */

test("the stage-history source check is only ever widened, never restated from a fixed list", () => {
  // Live it also allows LA-3's 'application_sync' (20260926101000). A fixed restatement dropped it.
  assert.doesNotMatch(foundations, /add constraint tenant_lead_stage_events_source_check\s+check \(source = any \(array\['board'/);
  assert.match(foundations, /regexp_matches\(coalesce\(v_def, ''\), '''\(\[a-z_\]\+\)''', 'g'\)/, "reads the live values");
  assert.match(foundations, /if v_def is not null and v_values @> v_needed then/, "a no-op when inbound and dialer are already there");
  assert.match(foundations, /unnest\(v_values \|\| v_needed\)/, "keeps every live value and adds the needed ones");
  assert.match(foundations, /'application_sync'/, "asserts LA-3's source survives");
});

test("LA-1.10-2: the inbox works out age from the date of birth, and a bad date is unknown, never an error", () => {
  const age = fn(foundations, "lead_values_age");
  assert.match(age, /p_values->>'age'/);
  assert.match(age, /'date_of_birth', p_values->>'dob', p_values->>'birth_date'/);
  assert.match(age, /exception when others then\s+return null;/);
  assert.match(age, /if v_years > 130 then return null; end if;/);
  assert.match(fn(foundations, "list_transfer_inbox"), /coalesce\(public\.lead_values_age\(l\.values\), '—'\) as age/);
  assert.match(inbox, /\{ageLabel\(item\.age\)\}/, "the inbox's Age column shows it");
});

test("LA-1.13-2: an initial quote somebody gave is never replaced, only a blank one is composed", () => {
  const trigger = fn(foundations, "deal_flow_compose_initial_quote");
  assert.match(trigger, /if nullif\(btrim\(coalesce\(new\.initial_quote, ''\)\), ''\) is not null then\s+return new;/);
  assert.match(foundations, /where nullif\(btrim\(coalesce\(initial_quote, ''\)\), ''\) is null\s+and public\.compose_initial_quote/, "the backfill fills blanks only");
  assert.match(fn(foundations, "lead_value_cents"), /'\^\[0-9\]\{1,15\}\$'/, "whole cents only: '50.72' is dollars, not 51 cents");
  assert.doesNotMatch(foundations, /update public\.lead_queue\s+set buffer_ended_at/, "no history-wide lead_queue backfill");
});

test("each later file refuses to run before the one it needs", () => {
  assert.match(requeue, /raise exception '20260925709860 needs 20260925709850 first/);
  assert.match(history, /raise exception '20260925709870 needs 20260925709850 first/);
  for (const sql of [requeue, history]) assert.match(sql, /if not has_schema_privilege\(current_user, 'public', 'CREATE'\) then\s+raise notice '[0-9]+: precondition skipped/);
});

test("LA-1.11-6 / LA-1.14-7: a re-claim resumes the session and reports it, with the requeue count", () => {
  const claim = fn(requeue, "claim_transfer_lead");
  assert.match(claim, /if item\.requeued_at is not null then/);
  assert.match(claim, /set status = 'open', ended_at = null, completed_at = null, user_id = p_user_id/);
  assert.match(claim, /'resumed_verification', v_resumed, 'requeue_count', coalesce\(item\.requeue_count, 0\)/);
  assert.match(claim, /where work_item_id = item\.id and tenant_id = p_tenant_id and ended_at is null;/, "every stale call on an unclaimed transfer is closed");
  assert.doesNotMatch(claim, /interval '2 hours'/);
});

test("LA-1.14-10: language gates the claim, claim next skips and explains, the handoff lets a speaking buffer cover", () => {
  assert.match(fn(requeue, "claim_transfer_lead"), /if not public\.agent_speaks_language\(p_tenant_id, p_user_id, v_language\) then\s+raise exception using errcode = 'P0001', message = 'LANGUAGE_NOT_SPOKEN', detail = v_language;/);
  const next = fn(requeue, "claim_next_transfer");
  assert.match(next, /and public\.agent_speaks_language\(p_tenant_id, p_user_id, public\.lead_language_key\(l\.values\)\)\s+order by q\.queued_at asc, q\.id asc\s+limit 1\s+for update of q skip locked;/);
  assert.match(next, /if v_language is not null then\s+raise exception using errcode = 'P0001', message = 'LANGUAGE_NOT_SPOKEN'/);
  for (const name of ["offer_buffer_handoff", "accept_buffer_handoff"]) assert.match(fn(requeue, name), /and not public\.agent_speaks_language\(p_tenant_id, (handoff_row\.buffer_user_id|p_buffer_user_id), v_language\)/);
});

test("LA-1.10-8: a requeue waits again from now, resets the ladder, restarts the walk and reopens the deal", () => {
  const back = fn(requeue, "return_transfer_to_queue");
  assert.match(back, /if q\.status <> 'dropped' then raise exception using errcode = 'P0001', message = 'NOT_DROPPED';/);
  assert.match(back, /queued_at = now\(\),\s+sla_warned_at = null, sla_escalated_at = null, sla_partner_notified_at = null, sla_expired_at = null,\s+requeued_at = now\(\), requeue_count = coalesce\(requeue_count, 0\) \+ 1/);
  assert.match(back, /current_node_id = v_flow\.root_node_id, status = 'open', completed_at = null/);
  assert.match(back, /update public\.deal_flow set status = 'partial', updated_at = now\(\)\s+where tenant_id = p_tenant_id and lead_id = q\.lead_id and status = 'dropped';/);
  assert.match(back, /'tenant\.transfer_requeued' else 'tenant\.transfer_unassigned'/);
});

test("LA-1.14-9: ending buffer involvement keeps owner, call and verification, and refuses a finished call", () => {
  const end = fn(requeue, "end_buffer_involvement");
  assert.match(end, /if q\.status in \('buffer_active', 'handed_pending'\) then raise exception using errcode = 'P0001', message = 'BUFFER_OWNS_CALL';/);
  assert.match(end, /if q\.status not in \('claimed', 'la_active'\) then raise exception using errcode = 'P0001', message = 'CALL_ENDED';/);
  assert.match(end, /message = 'LANGUAGE_COVER_REQUIRED'/);
  assert.doesNotMatch(end, /owner_user_id = null|tenant_verification_sessions/, "ownership and the verification do not move");
  assert.match(fn(requeue, "accept_buffer_handoff"), /buffer_ended_at = null/, "the buffer stays on the call after the handoff");
});

test("every function is SECURITY DEFINER with a fixed search_path and callable by the service role only", () => {
  for (const [sql, names] of [[requeue, ["claim_transfer_lead", "claim_next_transfer", "offer_buffer_handoff", "accept_buffer_handoff", "return_transfer_to_queue", "end_buffer_involvement"]], [foundations, ["agent_speaks_language", "list_transfer_inbox"]]]) {
    for (const name of names) {
      const body = fn(sql, name);
      assert.match(body, /security definer/, `${name} is not security definer`);
      assert.match(body, /set search_path (to 'public', 'pg_catalog'|= public, pg_catalog)/, `${name} has no fixed search_path`);
      assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated, tenant_app;`), `${name} is not revoked from the browser roles`);
      assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role;`), `${name} is not granted to the service role`);
    }
  }
});

test("LA-1.12-10: an inbound disposition writes stage history and its activity row; an outbound one is left to the dialer", () => {
  assert.match(history, /case when v_item\.partner_id is not null then ''inbound'' else ''lead_detail'' end, p_user_id/);
  assert.match(history, /\|\| E'  if v_item\.partner_id is not null then\\n'\s+\|\| E'    update public\.tenant_lead_activity a\\n'/);
  assert.match(history, /raise exception '20260925709870: complete_disposition no longer has exactly one of each anchor, edit it by hand';/);
  assert.match(history, /replace\(pg_get_functiondef\(v_sig\), E'\\r\\n', E'\\n'\)/, "CRLF from the SQL editor is normalised before anchoring");
  assert.match(history, /position\('insert into public\.tenant_lead_stage_events' in v_src\) > position\('update public\.disposition_walks' in v_src\)/);
  assert.match(history, /''buffer_agent_name'', bu\.name/);
  assert.match(stageSync, /"owner_fix", "dialer", "inbound"\]/, "LA-3's sync treats an inbound outcome as a person's move");
  assert.match(pipelineViews, /inbound: " · inbound call outcome"/);
});

/* ── the app side ───────────────────────────────────────────────────────── */

test("the claim routes refuse a language clearly and say when the verification was resumed", () => {
  assert.match(claimRoute, /if \(error\.message === "LANGUAGE_NOT_SPOKEN"\) return NextResponse\.json\(\{ error: languageRefusal\(error\.details\), code: "language_not_spoken", language: error\.details \?\? null \}, \{ status: 409 \}\);/);
  assert.match(claimRoute, /resumed: claimWasResumed\(data\)/);
  assert.match(claimNextRoute, /resumed: claimWasResumed\(claim\)/);
  assert.match(claimNextRoute, /error\.code === "language_not_spoken" \? 409/);
  assert.match(service, /if \(error\.message === "LANGUAGE_NOT_SPOKEN"\) throw new ClaimNextError\("language_not_spoken", `The callers waiting asked for \$\{languageName\(error\.details\)\}/);
  assert.match(release, /case "CALL_ENDED": return new TransferReleaseError\("call_ended"/);
});

test("the release route is guarded, registered and classified", () => {
  assert.match(releaseRoute, /requireFeatureRole\("inbound_transfers", \["owner", "producer", "assistant"\], \{ write: true \}\)/);
  assert.match(releaseRoute, /action: z\.enum\(\["unassign", "requeue", "end_buffer"\]\)/);
  assert.match(releaseRoute, /\.strict\(\)/);
  assert.match(policy, /sourceFile: "app\/api\/app\/inbound\/release\/route\.ts", featureKey: "inbound_transfers", allowedRoles: \["owner", "producer", "assistant"\]/);
  assert.match(money, /"inbound\/release\/route\.ts",/);
});

test("every release is confirmed first, with one wording across the inbox, the floor and the lead page", () => {
  for (const [name, source] of [["inbox", inbox], ["floor", floor], ["lead page", leadPage]]) {
    assert.match(source, /window\.confirm\(releaseConfirmation\(/, `${name} does not confirm with releaseConfirmation`);
    assert.doesNotMatch(source, /action === "unassign" && !window\.confirm|kind === "unassign" && !window\.confirm/, `${name} still confirms only unassign`);
  }
  assert.match(floor, /onRelease\(call, "end_buffer"\)/);
  assert.match(leadPage, /data\.actions\.canEndBufferInvolvement/);
  assert.match(leadPage, /data\.actions\.canRequeue/);
  assert.match(inbox, /onRelease\(item, "requeue"\)/);
  assert.match(inbox, /\(mine \|\| isOwner\) && isWithAgent\(item\.status\)/, "an owner may unassign any transfer, as the database allows");
  assert.match(leadService, /canEndBufferInvolvement: Boolean\(queue && bufferInvolved/);
});

test("the claim toast says when verification resumed, everywhere a transfer is claimed", () => {
  assert.match(inbox, /notify\.arrive\(claimedMessage\(body\)\)/);
  assert.match(leadPage, /notify\.done\(claimedMessage\(body\)\)/);
});

test("the Agent Floor reads languages the way the database does", () => {
  assert.doesNotMatch(floor, /const LANGUAGE_CODES/, "no second copy of the code list");
  assert.match(floor, /import \{ languageKey, languageName, releaseConfirmation \} from "@\/lib\/transferInbox\/constants";/);
  assert.match(foundations, /\('ht', 'haitian creole'\)\) as m\(code, name\)/);
});
