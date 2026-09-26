// Run with: npm test
//
// LA-1.23 / W5: the unclaimed-SLA side effects run in the database every minute (20260925709910),
// after the day-old backlog is skipped (20260925709900). Email stays with the app job, which never
// repeats what the database already did.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { slaJobState, summariseSlaDay, SLA_JOB_STALE_SECONDS } from "./digestView.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const skip = read("supabase/migrations/20260925709900_unclaimed_sla_backlog_older_than_a_day_is_skipped.sql");
const main = read("supabase/migrations/20260925709910_unclaimed_sla_side_effects_run_every_minute.sql");
const service = read("lib/queueSla/service.ts");
const fnStart = main.indexOf("create or replace function public.run_unclaimed_sla_side_effects(");
const fn = main.slice(fnStart, main.indexOf("$function$;", fnStart));

test("the backlog skip marks day-old events processed with a reason and writes nothing else", () => {
  assert.match(skip, /set processed_at = now\(\),\s*handled_by = 'skipped',\s*skipped_reason = 'older_than_24_hours'/);
  assert.match(skip, /where e\.processed_at is null\s*and e\.occurred_at < now\(\) - interval '24 hours'/);
  // One audit row per tenant with the count, and a proof nothing was sent.
  assert.match(skip, /'tenant\.lead_sla_backlog_skipped', 'tenant'/);
  assert.match(skip, /raise exception 'the backlog skip wrote a side effect; it must only mark events'/);
  assert.doesNotMatch(skip.replace(/insert into public\.audit_log/g, ""), /insert into public\./);
});

test("the job skips anything older than a day and anything no longer unclaimed", () => {
  assert.match(fn, /if e\.occurred_at < p_now - interval '24 hours' then[\s\S]*?skipped_reason = 'older_than_24_hours'[\s\S]*?continue;/);
  assert.match(fn, /if e\.rung in \('escalate', 'partner'\) and v_status is distinct from 'unclaimed' then[\s\S]*?skipped_reason = 'no_longer_unclaimed'/);
  // Both checks come before anything is written anywhere else.
  const firstWrite = fn.indexOf("insert into public.agent_notifications");
  assert.ok(fn.indexOf("interval '24 hours'") < firstWrite && fn.indexOf("'no_longer_unclaimed'") < firstWrite);
});

test("the escalation alert and the nobody-claimed alert never collapse into one", () => {
  assert.match(fn, /':escalated'/);
  assert.match(fn, /':offered'/);
  assert.match(fn, /':nobody-claimed'/);
  assert.equal((fn.match(/on conflict \(tenant_id, recipient_user_id, source_key\) do nothing/g) ?? []).length, 4);
});

test("nobody-claimed goes to the agency's owners only, and the partner gets Design 1's notice shape", () => {
  const partner = fn.slice(fn.indexOf("elsif e.rung = 'partner' then"), fn.indexOf("elsif e.rung = 'expire' then"));
  assert.match(partner, /c\.channel_type = 'partner' and c\.status = 'active'/);
  assert.match(partner, /'system_card', null,/);
  assert.match(partner, /jsonb_build_object\('customer', v_name, 'notice', 'unclaimed_partner_notice'\)/);
  assert.match(partner, /' was not claimed before the response window\. Our team has been notified\.'/);
  assert.match(partner, /'unclaimed-sla:' \|\| e\.work_item_id::text \|\| ':partner', null\)\s*on conflict \(event_key\) where event_key is not null do nothing/);
  assert.doesNotMatch(partner, /'nobody_claimed'/);
  const agency = partner.slice(partner.indexOf("The agency side of it"));
  assert.match(agency, /'Nobody claimed: ' \|\| v_name/);
  assert.match(agency, /tu\.role::text = 'owner'/);
  assert.doesNotMatch(agency, /partner_messages|partner_notifications/);
});

test("email is marked owed for the app, never sent by the database", () => {
  assert.match(fn, /v_email_due := p_now;/);
  assert.doesNotMatch(fn, /email_log|send_email|net\.http/);
});

test("the job records a heartbeat whether it succeeds or fails, and the check runs it and rolls back", () => {
  assert.match(fn, /insert into public\.unclaimed_sla_job_runs \(source, started_at, finished_at, ok, report, error\)\s*values \('database', v_started, clock_timestamp\(\), v_ok,/);
  assert.match(fn, /exception when others then\s*get stacked diagnostics v_err = message_text;\s*v_report := jsonb_build_object\('ok', false/);
  assert.match(main, /perform cron\.schedule\('unclaimed-sla-side-effects', '\* \* \* \* \*',/);
  const check = main.slice(main.indexOf("-- ── check:"));
  assert.match(check, /v_report := public\.run_unclaimed_sla_side_effects\(now\(\), 1000\);/);
  assert.match(check, /raise exception 'ROLLBACK_OK';/);
  assert.match(check, /has_schema_privilege\(current_user, 'public', 'CREATE'\)/);
});

test("the app job calls the database job first and only does the work itself when it is missing", () => {
  const run = service.slice(service.indexOf("export async function processUnclaimedSla"));
  const rpc = run.indexOf('rpc("run_unclaimed_sla_side_effects"');
  assert.ok(rpc > 0);
  assert.ok(run.indexOf("processInApp(now)") > rpc);
  assert.match(run, /if \(database\.error\) \{\s*path = "app";\s*base = await processInApp\(now\);/);
  assert.match(run, /const owed = await sendOwedEscalationEmails\(\);/);
  const email = service.slice(service.indexOf("async function sendOwedEscalationEmails"), service.indexOf("async function processEvent"));
  assert.match(email, /\.not\("email_due_at", "is", null\)\.is\("email_done_at", null\)/);
  assert.ok(email.indexOf('settle("no_longer_unclaimed")') < email.indexOf("sendEmail("), "re-checked before sending");
});

test("the alert centre reads what the job did", () => {
  const summary = summariseSlaDay([
    { rung: "escalate", handled_by: "database", skipped_reason: null, outcome: { sent: true, ownerAlerts: 1, offered: 3 }, processed_at: "x", last_error: null, email_due_at: "x", email_done_at: null, email_outcome: null },
    { rung: "partner", handled_by: "database", skipped_reason: null, outcome: { sent: true, partnerMessageId: "m", nobodyClaimedOwnerAlerts: 1 }, processed_at: "x", last_error: null, email_due_at: null, email_done_at: null, email_outcome: null },
    { rung: "expire", handled_by: "database", skipped_reason: null, outcome: { nurture: { nurtured: true } }, processed_at: "x", last_error: null, email_due_at: null, email_done_at: null, email_outcome: null },
    { rung: "escalate", handled_by: "skipped", skipped_reason: "older_than_24_hours", outcome: {}, processed_at: "x", last_error: null, email_due_at: null, email_done_at: null, email_outcome: null },
    { rung: "partner", handled_by: null, skipped_reason: null, outcome: {}, processed_at: null, last_error: "boom", email_due_at: null, email_done_at: null, email_outcome: null },
  ]);
  assert.deepEqual(
    [summary.escalationsAlerted, summary.partnerNotices, summary.nobodyClaimedAlerts, summary.nurtured, summary.skipped, summary.retrying, summary.emailsOwed, summary.latestError],
    [1, 1, 1, 1, 1, 1, 1, "boom"],
  );
  const now = Date.parse("2026-09-25T12:00:00Z");
  assert.equal(slaJobState({ lastRunAt: null, lastRunOk: null, retrying: 0 }, now), "never_run");
  assert.equal(slaJobState({ lastRunAt: "2026-09-25T11:59:30Z", lastRunOk: true, retrying: 0 }, now), "ok");
  assert.equal(slaJobState({ lastRunAt: "2026-09-25T11:59:30Z", lastRunOk: false, retrying: 0 }, now), "failing");
  assert.equal(slaJobState({ lastRunAt: "2026-09-25T11:59:30Z", lastRunOk: true, retrying: 2 }, now), "failing");
  assert.equal(slaJobState({ lastRunAt: new Date(now - (SLA_JOB_STALE_SECONDS + 1) * 1000).toISOString(), lastRunOk: true, retrying: 0 }, now), "stale");
});
