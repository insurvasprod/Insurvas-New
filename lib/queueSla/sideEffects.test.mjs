// Run with: npm test
//
// LA-1.23 / W5: the unclaimed-SLA side effects run in the database every minute (20260925709910),
// after the day-old backlog is skipped (20260925709900). Email stays with the app job, which never
// repeats what the database already did, and never counts as pg_cron's heartbeat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isOlderThanADay,
  runFailedAsWhole,
  slaJobNotice,
  slaJobState,
  slaJobWords,
  summariseSlaDay,
  SLA_JOB_STALE_SECONDS,
  SLA_PENDING_LINE,
  STALE_AFTER_MS,
} from "./digestView.ts";
import { databaseHeartbeatRow, heartbeatState } from "./heartbeat.ts";

const raw = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const read = (path) => raw(path).replace(/\r\n/g, "\n");
const SKIP_FILE = "supabase/migrations/20260925709900_unclaimed_sla_backlog_older_than_a_day_is_skipped.sql";
const MAIN_FILE = "supabase/migrations/20260925709910_unclaimed_sla_side_effects_run_every_minute.sql";
const skip = read(SKIP_FILE);
const main = read(MAIN_FILE);
const service = read("lib/queueSla/service.ts");
const monitor = read("lib/queueSla/monitor.ts");
const digest = read("lib/queueSla/digest.ts");
const fnStart = main.indexOf("create or replace function public.run_unclaimed_sla_side_effects(");
const fn = main.slice(fnStart, main.indexOf("$function$;", fnStart));
const digestFnStart = main.indexOf("create or replace function public.refresh_unclaimed_sla_daily_digests(");
const digestFn = main.slice(digestFnStart, main.indexOf("$function$;", digestFnStart));
const check = main.slice(main.indexOf("-- ── check:"));

test("both migrations are safe to paste into the SQL editor as one script", () => {
  for (const [name, text] of [[SKIP_FILE, raw(SKIP_FILE)], [MAIN_FILE, raw(MAIN_FILE)]]) {
    assert.doesNotMatch(text, /\r/, `${name} has CRLF line endings`);
    // scripts/check-migrations.mjs splits statements on semicolons; one inside a comment breaks it.
    const commented = text.split("\n").filter((line) => /--[^\n]*;/.test(line) && !/^\s*[^-\s].*;\s*--/.test(line));
    assert.deepEqual(commented, [], `${name} has a semicolon inside a comment`);
    // PL/pgSQL ends an IF condition at its first THEN.
    assert.doesNotMatch(text, /\bif\b[^;]*\bcase\b[^;]*\bthen\b[^;]*\bthen\b/i, `${name} has CASE … THEN inside an IF condition`);
  }
});

test("the backlog skip marks day-old events processed with a reason and writes nothing else", () => {
  assert.match(skip, /set processed_at = now\(\),\s*handled_by = 'skipped',\s*skipped_reason = 'older_than_24_hours'/);
  assert.match(skip, /where e\.processed_at is null\s*and e\.occurred_at < now\(\) - interval '24 hours'/);
  // One audit row per tenant with the count, and a proof nothing was sent.
  assert.match(skip, /'tenant\.lead_sla_backlog_skipped', 'tenant'/);
  assert.match(skip, /raise exception 'the backlog skip wrote a side effect; it must only mark events'/);
  assert.doesNotMatch(skip.replace(/insert into public\.audit_log/g, ""), /insert into public\./);
  // The UPDATE can write nowhere else: it refuses to run if a trigger is ever added to the table.
  assert.match(skip, /from pg_trigger where tgrelid = 'public\.tenant_lead_sla_events'::regclass and not tgisinternal/);
  // Counted into jsonb first, then looped: no FOR over a data-modifying WITH.
  assert.doesNotMatch(skip, /for r in\s+with/i);
  assert.match(skip, /from jsonb_to_recordset\(v_rows\)/);
});

test("each migration checks itself, and the checker's role skips the assertions", () => {
  const skipCheck = skip.slice(skip.indexOf("-- ── check"));
  assert.match(skipCheck, /has_schema_privilege\(current_user, 'public', 'CREATE'\)/);
  assert.match(skipCheck, /column_name in \('handled_by', 'skipped_reason', 'outcome', 'email_due_at', 'email_done_at', 'email_outcome'\)\) <> 6/);
  assert.match(skipCheck, /tenant_lead_sla_events_email_due_idx/);
  // No subquery inside a table CHECK: each constraint is a plain predicate, added once.
  for (const constraint of skip.match(/check \([^\n]*\)/g) ?? []) assert.doesNotMatch(constraint, /select/i);
  assert.match(check, /has_schema_privilege\(current_user, 'public', 'CREATE'\)/);
  assert.match(check, /raise exception 'ROLLBACK_OK';/);
});

test("the job skips anything older than a day and anything no longer unclaimed", () => {
  assert.match(fn, /if e\.occurred_at < p_now - interval '24 hours' then[\s\S]*?skipped_reason = 'older_than_24_hours'[\s\S]*?continue;/);
  assert.match(fn, /if e\.rung in \('escalate', 'partner'\) and v_status is distinct from 'unclaimed' then[\s\S]*?skipped_reason = 'no_longer_unclaimed'/);
  // Both checks come before anything is written anywhere else.
  const firstWrite = fn.indexOf("insert into public.agent_notifications");
  assert.ok(fn.indexOf("interval '24 hours'") < firstWrite && fn.indexOf("'no_longer_unclaimed'") < firstWrite);
  // Once per event: each row is locked, skipped by a concurrent run, and marked processed in the same subtransaction.
  assert.match(fn, /where ev\.processed_at is null\s*and \(ev\.claimed_at is null or ev\.claimed_at < p_now - interval '10 minutes'\)[\s\S]*?for update skip locked/);
  assert.match(fn, /set processed_at = p_now, handled_by = 'database', skipped_reason = null, outcome = v_outcome/);
  // A failing row is retried, and given up after five tries.
  assert.match(fn, /processed_at = case when attempts \+ 1 >= 5 then p_now end/);
  assert.match(fn, /skipped_reason = case when attempts \+ 1 >= 5 then 'gave_up_after_failures' end/);
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

test("an expired transfer becomes a nurture lead, without a second dialer row where lead_queue is one-per-lead", () => {
  const expire = fn.slice(fn.indexOf("elsif e.rung = 'expire' then"));
  assert.match(expire, /v_nurture := public\.nurture_expired_transfer\(e\.tenant_id, e\.work_item_id, v_queue\);/);
  assert.match(expire, /exception when unique_violation then\s*[\s\S]*?public\.nurture_expired_transfer\(e\.tenant_id, e\.work_item_id, false\)/);
});

test("email is marked owed for the app, never sent by the database", () => {
  assert.match(fn, /v_email_due := p_now;/);
  assert.doesNotMatch(fn, /email_log|send_email|net\.http/);
});

test("only pg_cron's run is the heartbeat: the app's call records its own", () => {
  assert.match(main, /create or replace function public\.run_unclaimed_sla_side_effects\(\s*p_now timestamptz default now\(\), p_limit integer default 500, p_source text default 'database'\)/);
  assert.match(fn, /v_heartbeat boolean := coalesce\(p_source, 'database'\) = 'database';/);
  // Both heartbeat inserts, the success one and the whole-run failure one, are behind the flag.
  const inserts = [...fn.matchAll(/insert into public\.unclaimed_sla_job_runs/g)].map((m) => m.index);
  assert.equal(inserts.length, 2);
  for (const at of inserts) assert.match(fn.slice(Math.max(0, at - 60), at), /if v_heartbeat then\s*$/);
  assert.match(fn, /raise exception using errcode = '22023', message = 'INVALID_SOURCE'/);
  assert.match(main, /drop function if exists public\.run_unclaimed_sla_side_effects\(timestamptz, integer\);/);
  assert.match(main, /grant execute on function public\.run_unclaimed_sla_side_effects\(timestamptz, integer, text\) to service_role;/);
  assert.match(main, /revoke all on function public\.run_unclaimed_sla_side_effects\(timestamptz, integer, text\) from public, anon, authenticated, tenant_app;/);
  // The app passes 'app'.
  assert.match(service, /rpc\("run_unclaimed_sla_side_effects", \{ p_now: now, p_limit: 500, p_source: "app" \}\)/);
});

test("pg_cron runs it every minute under one job name, and the check runs it once and rolls back", () => {
  assert.match(main, /perform cron\.schedule\('unclaimed-sla-side-effects', '\* \* \* \* \*',\s*\$cron\$select public\.run_unclaimed_sla_side_effects\(now\(\), 500, 'database'\)\$cron\$\);/);
  assert.match(check, /from cron\.job where jobname = 'unclaimed-sla-side-effects'[\s\S]*?<> 1 then/);
  // The app-style call, which must not write the heartbeat…
  assert.match(check, /v_report := public\.run_unclaimed_sla_side_effects\(now\(\), 1000, 'app'\);/);
  assert.match(check, /raise exception 'CHECK an app-invoked run wrote the pg_cron heartbeat'/);
  // …then pg_cron's, which must, and must send nothing a second time.
  assert.match(check, /v_again := public\.run_unclaimed_sla_side_effects\(now\(\), 1000\);/);
  assert.match(check, /raise exception 'CHECK a second run sent again/);
  assert.match(check, /skipped_reason = 'no_longer_unclaimed'/);
  assert.match(check, /skipped_reason = 'older_than_24_hours'/);
  assert.match(check, /from public\.tenant_sla_daily_digests d/);
  // A real row failing elsewhere is a notice, not a failed migration.
  assert.match(check, /raise notice '20260925709910: % real event\(s\) failed in the check run/);
});

test("the digest closes a day ten minutes after its midnight, in the agency's own timezone", () => {
  assert.match(digestFn, /p_now >= v_end \+ interval '10 minutes'/);
  assert.match(digestFn, /from public\.agency_profiles ap where ap\.tenant_id = t\.tenant_id/);
  assert.match(digestFn, /if exists \(select 1 from public\.tenant_sla_daily_digests dd\s*where dd\.tenant_id = t\.tenant_id and dd\.digest_date = v_day and dd\.closed\) then\s*continue;/);
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
  assert.ok(email.indexOf('settle("older_than_24_hours")') < email.indexOf("sendEmail("), "day-old emails are settled, not sent");
  // The fallback records why nothing was sent, and still works before 20260925709900's columns exist.
  const mark = service.slice(service.indexOf("async function markProcessedInApp"));
  assert.match(mark, /handled_by: skippedReason === "older_than_24_hours" \? "skipped" : "app"/);
  assert.match(mark, /if \(!isSchemaGap\(recorded\.error\)\) throw/);
});

test("the heartbeat and the alert centre read pg_cron's runs, never a manual one", () => {
  assert.match(digest, /from\("unclaimed_sla_job_runs"\)\.select\("ok, error, report, started_at, finished_at"\)\.eq\("source", "database"\)/);
  assert.match(monitor, /\.eq\("source", "database"\)/);
  // Once the table exists the app's audit heartbeat is not consulted.
  assert.match(monitor, /if \(database\.error\) return heartbeatState\(appRow, Date\.now\(\), maxAgeSeconds\);\s*[\s\S]*?return heartbeatState\(databaseHeartbeatRow\(dbRun\), Date\.now\(\), maxAgeSeconds\);/);
});

test("pg_cron's run row reads as a heartbeat", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  assert.equal(databaseHeartbeatRow(null), null);
  const ok = databaseHeartbeatRow({ ok: true, report: { events: 3 }, error: null, started_at: "2026-09-29T11:59:00Z", finished_at: "2026-09-29T11:59:01Z" });
  assert.deepEqual(heartbeatState(ok, now, 900), { healthy: true, reason: "ok", lastRunAt: "2026-09-29T11:59:01Z", ageSeconds: 59, lastReport: { source: "database", report: { events: 3 }, error: null } });
  const failed = databaseHeartbeatRow({ ok: false, report: {}, error: "boom", started_at: "2026-09-29T11:59:00Z", finished_at: null });
  assert.equal(heartbeatState(failed, now, 900).reason, "last_run_failed");
  assert.equal(heartbeatState(ok, now + 3_600_000, 900).reason, "stale");
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

test("only a whole-run failure is every workspace's news, and another workspace's error is never shown", () => {
  assert.equal(runFailedAsWhole({ ok: false, error: "statement timeout" }, "statement timeout"), true);
  assert.equal(runFailedAsWhole({ ok: false, ladder: { fired: 0, error: "deadlock" } }, "deadlock"), true);
  assert.equal(runFailedAsWhole({ ok: false, digest: { rows: 0, error: "bad zone" } }, "bad zone"), true);
  // One event failing in some tenant: the run is not ok, but it is not this workspace's failure.
  assert.equal(runFailedAsWhole({ ok: false, ladder: { fired: 2, error: null }, digest: { rows: 1, error: null }, failed: 1, failures: [{ error: "Key (lead_id)=(…)" }] }, "Key (lead_id)=(…)"), false);
  assert.equal(runFailedAsWhole({}, "died"), true);
  assert.equal(runFailedAsWhole(null, null), false);
  assert.match(digest, /lastError: lastDay\.latestError \?\? \(wholeRunFailed \? "The job's last run failed before it finished\." : null\)/);
});

test("the SLA job's words: one alert line when it fails or stops, one pending line before the migration", () => {
  assert.deepEqual(slaJobWords("ok"), { label: "Running", alert: null });
  assert.equal(slaJobWords("stale").label, "Stopped");
  assert.match(slaJobWords("stale").alert, /has stopped/);
  assert.match(slaJobWords("failing").alert, /tried again every minute/);
  assert.equal(slaJobWords("pending_migration").alert, null);
  assert.match(SLA_PENDING_LINE, /database update that has not been applied yet/);
  assert.equal(slaJobNotice("ok"), null);
  assert.deepEqual(slaJobNotice("pending_migration"), { tone: "info", text: "Escalation alerts, partner notices and nurture moves need a database update that has not been applied yet." });
  assert.equal(slaJobNotice("stale").tone, "error");
});

test("a day-old side effect is recognised the same way everywhere", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  assert.equal(STALE_AFTER_MS, 86_400_000);
  assert.equal(isOlderThanADay("2026-09-28T11:59:59Z", now), true);
  assert.equal(isOlderThanADay("2026-09-28T12:00:01Z", now), false);
  assert.equal(isOlderThanADay(null, now), false);
  assert.equal(isOlderThanADay("not a date", now), false);
});
