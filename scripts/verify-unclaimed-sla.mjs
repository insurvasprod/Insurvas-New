import "./lib/refuseProduction.mjs";
// LA-1.23 focused live contract check. It intentionally stops with a clear prerequisite failure
// when the numbered migration is not present; local TypeScript/build evidence must not masquerade
// as proof that the connected Supabase project has the scheduler.
//
// Database only (no app server). Writes one namespaced fixture tenant — its owner, partner, partner
// channel, leads, transfers and SLA events — and removes all of it at the end.
//
// pg_cron runs the ladder every minute (20260924250100) and, once 20260925709910 is applied, the side
// effects too. Both can reach this script's fixtures between two of its calls, so the checks assert
// what must be true whoever fired a rung (one event per rung, in order, reported at most once) rather
// than that THIS call fired it. The ladder steps are timed away from the minute boundary pg_cron fires
// on, so in practice the script's own calls fire them.
//
//   node --env-file=.env.local scripts/verify-unclaimed-sla.mjs
import { createClient } from "@supabase/supabase-js";
import { createFixtureUser, deleteFixtureUser } from "./lib/fixtureUser.mjs";
import { randomUUID } from "node:crypto";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const requiredTables = ["tenant_queue_sla_settings", "tenant_lead_sla_events"];
let failures = 0;
let skips = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures += 1; } };
const skip = (label, why) => { console.log(`  skip ${label} — ${why}`); skips += 1; };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const SCHEMA_GAP = new Set(["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"]);
const isSchemaGap = (error) => Boolean(error) && (SCHEMA_GAP.has(error.code) || /does not exist|schema cache/i.test(error.message ?? ""));

for (const table of requiredTables) {
  const result = await db.from(table).select("*").limit(1);
  check(`${table} exists in connected Supabase`, !result.error, result.error?.message);
}
if (failures) { console.log("\nLA-1.23 live checks stopped: apply the numbered migration first."); process.exit(1); }

// Which of the side-effect migrations are live. Absent, their checks say so and are skipped.
async function present(probe) {
  const result = await probe;
  if (!result.error) return true;
  if (isSchemaGap(result.error)) return false;
  throw new Error(`Could not probe the schema: ${result.error.message}`);
}
const backlogSkipLive = await present(db.from("tenant_lead_sla_events").select("handled_by, skipped_reason, outcome, email_due_at").limit(1)); // 20260925709900
const sideEffectsLive = await present(db.from("unclaimed_sla_job_runs").select("id").limit(1)); // 20260925709910

// The database's clock, from the REST response, so the steps can be kept away from pg_cron's minute.
async function serverSkewMs() {
  const before = Date.now();
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY } }).catch(() => null);
  const header = response?.headers.get("date");
  const server = header ? Date.parse(header) : NaN;
  return Number.isFinite(server) ? server + 500 - (before + Date.now()) / 2 : 0;
}
const skew = await serverSkewMs();
/** Waits until the database clock is between :05 and :35 of its minute: well clear of pg_cron's :00. */
async function clearOfTheMinute() {
  for (;;) {
    const second = new Date(Date.now() + skew).getUTCSeconds();
    if (second >= 5 && second <= 35) return;
    await sleep(500);
  }
}

const tenantId = randomUUID();
const partnerId = randomUUID();
let userId = null;
let pipelineId = null;
let stageId = null;
let template = null;
async function cleanup() {
  await db.from("tenant_lead_sla_events").delete().eq("tenant_id", tenantId);
  await db.from("lead_queue").delete().eq("tenant_id", tenantId);
  await db.from("agent_leads").delete().eq("tenant_id", tenantId);
  await db.from("tenant_queue_sla_settings").delete().eq("tenant_id", tenantId);
  await db.from("tenant_users").delete().eq("tenant_id", tenantId);
  // The side-effect runner (20260925709910) may have written a partner card, a partner notice and
  // agent alerts for the fixture transfer; none of them outlives the fixture.
  for (const table of ["partner_messages", "partner_notifications", "agent_notifications"]) await db.from(table).delete().eq("tenant_id", tenantId);
  await db.from("partner_chat_channels").delete().eq("tenant_id", tenantId);
  await db.from("partner_channels").delete().eq("tenant_id", tenantId);
  await db.from("tenant_sla_daily_digests").delete().eq("tenant_id", tenantId);
  await db.from("partners").delete().eq("tenant_id", tenantId);
  await deleteFixtureUser(db, userId);
  await db.from("tenants").delete().eq("id", tenantId);
}

async function setLadder(warn, escalate, partner, expire) {
  const result = await db.rpc("update_tenant_queue_sla_settings", { p_tenant_id: tenantId, p_actor: userId, p_warn: warn, p_escalate: escalate, p_partner: partner, p_expire: expire });
  if (result.error) throw result.error;
}

/** A partner transfer, as partner intake writes one: the ladder only runs over rows with a partner (20260924150000). */
async function transfer(name, fields) {
  const leadId = randomUUID();
  const workItemId = randomUUID();
  const lead = await db.from("agent_leads").insert({ id: leadId, tenant_id: tenantId, template_id: template.id, template_version: template.version, product_line: template.product_code, pipeline_id: pipelineId, stage_id: stageId, values: { full_name: name }, created_by: userId });
  if (lead.error) throw lead.error;
  const queue = await db.from("lead_queue").insert({ id: workItemId, tenant_id: tenantId, lead_id: leadId, product_line: template.product_code, pipeline_id: pipelineId, stage_id: stageId, partner_id: partnerId, status: "unclaimed", ...fields });
  if (queue.error) throw queue.error;
  return { leadId, workItemId };
}

/** run_unclaimed_sla works the oldest unclaimed transfers in the whole table; 1000 is its ceiling. */
async function ladder(pNow) {
  const result = await db.rpc("run_unclaimed_sla", { p_now: pNow, p_limit: 1000 });
  if (result.error) throw result.error;
  return result.data ?? [];
}

async function eventsFor(workItemId, columns = "id, rung, occurred_at") {
  const result = await db.from("tenant_lead_sla_events").select(columns).eq("tenant_id", tenantId).eq("work_item_id", workItemId);
  if (result.error) throw result.error;
  return result.data ?? [];
}

const RUNGS = ["warn", "escalate", "partner", "expire"];
const perRung = (events) => Object.fromEntries(RUNGS.map((rung) => [rung, events.filter((row) => row.rung === rung).length]));

async function expiryAudit(workItemId) {
  const result = await db.from("audit_log").select("metadata").eq("action", "tenant.lead_sla_expired").eq("target_type", "lead_queue").eq("target_id", workItemId);
  if (result.error) throw result.error;
  return result.data ?? [];
}

try {
  const tenant = await db.from("tenants").insert({ id: tenantId, name: `LA-1.23 QA ${Date.now()}`, status: "active", onboarding_state: "completed" }); if (tenant.error) throw tenant.error;
  ({ userId } = await createFixtureUser(db, { email: `la123-${Date.now()}@invalid.test`, name: "LA-1.23 QA" }));
  const member = await db.from("tenant_users").insert({ tenant_id: tenantId, user_id: userId, role: "owner", accepted_at: new Date().toISOString() }); if (member.error) throw member.error;
  const seeded = await db.rpc("seed_default_pipelines", { p_tenant_id: tenantId }); if (seeded.error) throw seeded.error;
  const pipeline = await db.from("tenant_pipelines").select("id").eq("tenant_id", tenantId).eq("partner_type", "publisher").eq("is_default", true).single(); if (pipeline.error) throw pipeline.error; pipelineId = pipeline.data.id;
  const stage = await db.from("tenant_pipeline_stages").select("id").eq("pipeline_id", pipelineId).eq("is_archived", false).order("position").limit(1).single(); if (stage.error) throw stage.error; stageId = stage.data.id;
  const templateRow = await db.from("templates").select("id, version, product_code").eq("is_active", true).limit(1).single(); if (templateRow.error) throw templateRow.error; template = templateRow.data;
  // The ladder is for inbound transfers only (20260924150000): it reads unclaimed rows WITH a
  // partner, because imports and vendor posts are the dialer's queue and must never expire. So each
  // fixture work item below is a partner transfer, as partner intake would write it.
  const partner = await db.from("partners").insert({ id: partnerId, slug: `fx-${Math.random().toString(36).slice(2, 10)}`, tenant_id: tenantId, name: `LA-1.23 Partner ${Date.now()}`, partner_type: "publisher", status: "active", timezone: "America/Phoenix" }); if (partner.error) throw partner.error;
  // The partner's chat channel, where the partner-rung notice is posted (Design 1).
  const channelInsert = await db.from("partner_channels").upsert({ tenant_id: tenantId, partner_id: partnerId, channel_type: "partner", name: "LA-1.23 partner channel", status: "active", created_by: userId }, { onConflict: "tenant_id,partner_id,channel_type", ignoreDuplicates: true });
  if (channelInsert.error) throw channelInsert.error;
  const channel = await db.from("partner_channels").select("id").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("channel_type", "partner").single(); if (channel.error) throw channel.error;
  const channelId = channel.data.id;
  await setLadder(1, 2, 3, 4);

  // ── (a) a transfer queued now walks the ladder, one rung per run ──────────────────────────────
  // Thresholds 1 / 2 / 3 / 4 seconds, and a ladder run just after each: the first run warns, the
  // second escalates, the third tells the partner, the fourth expires. p_now is passed explicitly
  // (the script's clock, which also wrote queued_at), and real time is kept level with it so pg_cron,
  // on the database clock, can only ever fire a rung that is already due.
  await clearOfTheMinute();
  const t0 = Date.now();
  const walk = await transfer("LA-1.23 Walking Lead", { queued_at: new Date(t0).toISOString() });
  const reported = [];
  for (let step = 0; step < RUNGS.length; step += 1) {
    const at = t0 + (step + 1) * 1000 + 300;
    await sleep(at - Date.now());
    reported.push((await ladder(new Date(at).toISOString())).filter((row) => row.work_item_id === walk.workItemId).map((row) => row.rung));
  }
  const walkEvents = await eventsFor(walk.workItemId);
  const walkCounts = perRung(walkEvents);
  check("a transfer queued now fires warn, escalate, partner and expire, each exactly once", RUNGS.every((rung) => walkCounts[rung] === 1), JSON.stringify(walkCounts));
  // Each run reports only the rung that came due at its time; a rung missing from a report is one
  // pg_cron fired first, and must then be in the table.
  const perStep = reported.map((rungs, step) => ({ step: step + 1, reported: rungs, expected: RUNGS[step] }));
  const flat = reported.flat();
  check(
    "each run reports only the rung that came due, and each rung is reported at most once",
    perStep.every(({ reported: rungs, expected }) => rungs.every((rung) => rung === expected) && (rungs.includes(expected) || walkCounts[expected] === 1)) && new Set(flat).size === flat.length,
    JSON.stringify(perStep),
  );
  check("the job reports the rungs it fired (all four across the walk, unless pg_cron fired one first)", flat.length >= 3, JSON.stringify(reported));
  const walkTimes = RUNGS.map((rung) => walkEvents.find((row) => row.rung === rung)?.occurred_at).map((iso) => (iso ? Date.parse(iso) : NaN));
  check("the rungs fired in order across separate runs, not all at once", walkTimes.every(Number.isFinite) && walkTimes.every((time, index) => index === 0 || time >= walkTimes[index - 1]) && walkTimes[3] > walkTimes[0], JSON.stringify(walkEvents.map((row) => [row.rung, row.occurred_at])));
  const walkExpiry = await expiryAudit(walk.workItemId);
  check("a walked expiry is not a quiet one", walkExpiry.length === 1 && walkExpiry[0].metadata?.quiet === false, JSON.stringify(walkExpiry.map((row) => row.metadata)));
  const again = await ladder(new Date().toISOString());
  check("a later run reports no repeat work", again.filter((row) => row.work_item_id === walk.workItemId).length === 0);

  // ── (b) a transfer already past expiry with no rung fired expires quietly ─────────────────────
  // The job was not running while it waited, and the caller is long gone: warning, escalating and
  // telling the partner now would be news about nobody (20260924250100).
  const oldAt = new Date("2020-01-01T00:00:00.000Z").toISOString();
  const quiet = await transfer("LA-1.23 Old Lead", { queued_at: oldAt });
  const claimed = await transfer("LA-1.23 Claimed Lead", { status: "claimed", claimed_by: userId, claimed_at: oldAt, queued_at: oldAt });
  const quietRun = await ladder(new Date().toISOString());
  const quietEvents = await eventsFor(quiet.workItemId);
  const quietAudit = await expiryAudit(quiet.workItemId);
  const quietRow = await db.from("lead_queue").select("status, sla_warned_at, sla_escalated_at, sla_partner_notified_at, sla_expired_at").eq("id", quiet.workItemId).single();
  check(
    "a transfer already past expiry with no rung fired expires quietly: only 'expire', audit quiet=true",
    JSON.stringify(perRung(quietEvents)) === JSON.stringify({ warn: 0, escalate: 0, partner: 0, expire: 1 })
      && quietAudit.length === 1 && quietAudit[0].metadata?.quiet === true
      && quietRow.data?.status === "expired" && quietRow.data.sla_warned_at === null && quietRow.data.sla_escalated_at === null && quietRow.data.sla_partner_notified_at === null,
    JSON.stringify({ rungs: perRung(quietEvents), audit: quietAudit.map((row) => row.metadata), row: quietRow.data }),
  );
  const quietReported = quietRun.filter((row) => row.work_item_id === quiet.workItemId).map((row) => row.rung);
  check("the quiet expiry is reported as 'expire' alone", quietReported.length === 0 ? quietEvents.length === 1 : quietReported.join(",") === "expire", JSON.stringify(quietReported));

  const claimedRow = await db.from("lead_queue").select("status, sla_expired_at").eq("id", claimed.workItemId).single();
  check("claimed lead is never expired by scheduler", claimedRow.data?.status === "claimed" && claimedRow.data.sla_expired_at === null);
  // Criterion 2 is "claiming at any point stops the WHOLE ladder immediately". A claimed lead must
  // collect none of the four rungs -- not merely avoid the last one.
  const claimedEvents = await eventsFor(claimed.workItemId, "rung");
  const claimedMarkers = await db.from("lead_queue").select("sla_warned_at, sla_escalated_at, sla_partner_notified_at, sla_expired_at").eq("id", claimed.workItemId).single();
  check("claiming stops every rung, not just expiry", claimedEvents.length === 0 && Object.values(claimedMarkers.data ?? {}).every((value) => value === null), JSON.stringify({ events: claimedEvents.map((row) => row.rung), markers: claimedMarkers.data }));

  // ── a threshold change takes effect on the next run with no deploy ────────────────────────────
  // Raise the ladder first, then add a three-day-old transfer: every rung (4, 5, 6 and 7 days) now
  // sits beyond its age, so the unchanged job must stay quiet about it. update_tenant_queue_sla_settings
  // caps expiry at 7 days. The ladder is raised BEFORE the transfer exists so pg_cron cannot reach it
  // under the old 1..4-second ladder in between.
  await setLadder(345600, 432000, 518400, 604800);
  const later = await transfer("LA-1.23 Threshold Lead", { queued_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString() });
  await ladder(new Date().toISOString());
  const laterEvents = await eventsFor(later.workItemId, "rung");
  const laterRow = await db.from("lead_queue").select("status").eq("id", later.workItemId).single();
  check("raising a threshold takes effect on the next run with no deploy", laterEvents.length === 0 && laterRow.data?.status === "unclaimed", JSON.stringify({ rungs: laterEvents.map((row) => row.rung), status: laterRow.data?.status }));

  // Criterion 4 is "expired leads are readable AND reopenable". Expiry takes the row out of the
  // ACTIVE queue without taking it out of the record.
  const expiredRow = await db.from("lead_queue").select("id, status, sla_expired_at").eq("id", quiet.workItemId).maybeSingle();
  const expiredLead = await db.from("agent_leads").select("id, values").eq("id", quiet.leadId).maybeSingle();
  check("an expired lead is still fully readable", expiredRow.data?.status === "expired" && Boolean(expiredRow.data?.sla_expired_at) && expiredLead.data?.values?.full_name === "LA-1.23 Old Lead", JSON.stringify({ queue: expiredRow.data?.status, lead: expiredLead.data?.values?.full_name ?? "gone" }));
  const reopened = await db.rpc("reopen_expired_lead", { p_tenant_id: tenantId, p_work_item_id: quiet.workItemId, p_actor: userId }); check("expired lead can be reopened", !reopened.error && reopened.data?.status === "unclaimed", reopened.error?.message);
  const duplicate = await db.rpc("reopen_expired_lead", { p_tenant_id: tenantId, p_work_item_id: quiet.workItemId, p_actor: userId }); check("reopening twice is idempotent", !duplicate.error && duplicate.data?.duplicate === true, duplicate.error?.message);

  // ── (c) the side effects, delivered by pg_cron (20260925709900, 20260925709910) ───────────────
  if (!backlogSkipLive || !sideEffectsLive) {
    const pending = [!backlogSkipLive && "20260925709900", !sideEffectsLive && "20260925709910"].filter(Boolean).join(" and ");
    for (const label of [
      "a side effect older than 24 hours is recorded as skipped, never sent",
      "pg_cron alerts every owner on escalation, marks the email owed, posts the partner notice and alerts owners nobody claimed",
      "a late escalation or partner notice for a transfer claimed since is recorded, not sent",
      "an expired transfer becomes a nurture lead",
      "the side-effect job writes its heartbeat and the daily digest",
    ]) skip(label, `schema pending: apply ${pending}`);
  } else {
    // The earlier transfers are done with; close them so the short ladder below cannot reach them.
    const closed = await db.from("lead_queue").update({ status: "closed" }).eq("tenant_id", tenantId).in("id", [quiet.workItemId, later.workItemId]);
    if (closed.error) throw closed.error;
    // A ladder whose first three rungs fire together and whose expiry is days away, so the transfers
    // are still unclaimed when pg_cron gets to their escalation and partner notice.
    await setLadder(1, 2, 3, 604800);
    await clearOfTheMinute();
    const sent = await transfer("LA-1.23 Side Effect Lead", { queued_at: new Date(Date.now() - 5000).toISOString() });
    const late = await transfer("LA-1.23 Claimed In Time Lead", { queued_at: new Date(Date.now() - 5000).toISOString() });
    await ladder(new Date().toISOString());
    // Claimed straight after its rungs fired, before any side-effect run: its escalation and partner
    // notice are no longer news.
    const claim = await db.from("lead_queue").update({ status: "claimed", claimed_by: userId, claimed_at: new Date().toISOString() }).eq("id", late.workItemId);
    if (claim.error) throw claim.error;
    const stale = await db.from("tenant_lead_sla_events").insert({ tenant_id: tenantId, work_item_id: later.workItemId, lead_id: later.leadId, partner_id: partnerId, rung: "escalate", occurred_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() }).select("id").single();
    if (stale.error) throw stale.error;

    const waitingFrom = new Date().toISOString();
    const watched = async () => {
      const result = await db.from("tenant_lead_sla_events").select("id, work_item_id, rung, processed_at, handled_by, skipped_reason, outcome, email_due_at, last_error").eq("tenant_id", tenantId).in("work_item_id", [sent.workItemId, late.workItemId, later.workItemId, walk.workItemId]);
      if (result.error) throw result.error;
      return result.data ?? [];
    };
    let rows = await watched();
    const deadline = Date.now() + 150_000;
    console.log("  …    waiting for pg_cron's side-effect run (up to 150 s)");
    while (rows.some((row) => row.processed_at === null) && Date.now() < deadline) {
      await sleep(5000);
      rows = await watched();
    }
    const pendingRows = rows.filter((row) => row.processed_at === null);
    check("pg_cron processes every fixture event within 150 s (unclaimed-sla-side-effects is scheduled)", pendingRows.length === 0, JSON.stringify(pendingRows.map((row) => ({ rung: row.rung, lastError: row.last_error }))));

    const find = (workItemId, rung) => rows.find((row) => row.work_item_id === workItemId && row.rung === rung);
    const staleRow = rows.find((row) => row.id === stale.data.id);
    check("a side effect older than 24 hours is recorded as skipped, never sent", staleRow?.handled_by === "skipped" && staleRow.skipped_reason === "older_than_24_hours" && staleRow.email_due_at === null, JSON.stringify(staleRow));

    const alerts = await db.from("agent_notifications").select("recipient_user_id, source_key").eq("tenant_id", tenantId);
    if (alerts.error) throw alerts.error;
    const keyed = (key) => (alerts.data ?? []).filter((row) => row.source_key === key);
    const messages = await db.from("partner_messages").select("channel_id, work_item_id, message, message_kind, card_type, card_payload, event_key, created_by").eq("tenant_id", tenantId);
    if (messages.error) throw messages.error;
    const escalation = find(sent.workItemId, "escalate");
    const partnerRung = find(sent.workItemId, "partner");
    const notice = (messages.data ?? []).filter((row) => row.event_key === `unclaimed-sla:${sent.workItemId}:partner`);
    check(
      "pg_cron alerts every owner on escalation, marks the email owed, posts the partner notice and alerts owners nobody claimed",
      escalation?.handled_by === "database" && escalation.skipped_reason === null && escalation.outcome?.ownerAlerts === 1 && Boolean(escalation.email_due_at)
        && keyed(`unclaimed-sla:${sent.workItemId}:escalated`).length === 1 && keyed(`unclaimed-sla:${sent.workItemId}:escalated`)[0].recipient_user_id === userId
        && partnerRung?.handled_by === "database" && partnerRung.skipped_reason === null && typeof partnerRung.outcome?.partnerMessageId === "string"
        && notice.length === 1 && notice[0].channel_id === channelId && notice[0].message_kind === "system_card" && notice[0].card_type === null
        && notice[0].card_payload?.notice === "unclaimed_partner_notice" && notice[0].created_by === null
        && keyed(`unclaimed-sla:${sent.workItemId}:nobody-claimed`).length === 1
        && !(messages.data ?? []).some((row) => row.card_type === "nobody_claimed"),
      JSON.stringify({ escalation, partner: partnerRung, notice, alerts: alerts.data }),
    );
    const warnRow = find(sent.workItemId, "warn");
    check("a warning is recorded with nothing sent (the floor shows it)", warnRow?.handled_by === "database" && warnRow.outcome?.sent === false, JSON.stringify(warnRow));

    const lateRows = ["escalate", "partner"].map((rung) => find(late.workItemId, rung));
    check(
      "a late escalation or partner notice for a transfer claimed since is recorded, not sent",
      lateRows.every((row) => row?.handled_by === "database" && row.skipped_reason === "no_longer_unclaimed")
        && (alerts.data ?? []).every((row) => !row.source_key.startsWith(`unclaimed-sla:${late.workItemId}:`))
        && (messages.data ?? []).every((row) => row.work_item_id !== late.workItemId),
      JSON.stringify(lateRows),
    );

    const expireRow = find(walk.workItemId, "expire");
    const nurtured = await db.from("agent_leads").select("lead_state").eq("id", walk.leadId).single();
    check("an expired transfer becomes a nurture lead", expireRow?.handled_by === "database" && expireRow.outcome?.nurture?.nurtured === true && nurtured.data?.lead_state === "nurture", JSON.stringify({ outcome: expireRow?.outcome, leadState: nurtured.data?.lead_state }));

    const run = await db.from("unclaimed_sla_job_runs").select("ok, started_at, report").eq("source", "database").order("started_at", { ascending: false }).limit(1).maybeSingle();
    const digest = await db.from("tenant_sla_daily_digests").select("digest_date, escalated, expired, by_partner, closed").eq("tenant_id", tenantId);
    const openDay = (digest.data ?? []).find((row) => !row.closed);
    check(
      "the side-effect job writes its heartbeat and the daily digest",
      Boolean(run.data) && Date.parse(run.data.started_at) >= Date.parse(waitingFrom) - 60_000
        && Boolean(openDay) && openDay.escalated >= 2 && openDay.expired >= 1 && Array.isArray(openDay.by_partner) && openDay.by_partner.some((row) => row.partnerId === partnerId),
      JSON.stringify({ run: run.data && { ok: run.data.ok, started_at: run.data.started_at }, digest: digest.data }),
    );
  }
} finally { await cleanup(); }
// Every other suite in this module prints a summary line, and a sweep that greps for one reads this
// suite's silence as "produced no output" rather than "passed".
const skipped = skips ? ` (${skips} skipped: schema pending)` : "";
console.log(failures ? `\n${failures} LA-1.23 check(s) FAILED.${skipped}` : `\nAll LA-1.23 unclaimed-SLA checks passed.${skipped}`);
process.exit(failures ? 1 : 0);
