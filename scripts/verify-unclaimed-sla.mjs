// LA-1.23 focused live contract check. It intentionally stops with a clear prerequisite failure
// when the numbered migration is not present; local TypeScript/build evidence must not masquerade
// as proof that the connected Supabase project has the scheduler.
import { createClient } from "@supabase/supabase-js";
import { createFixtureUser, deleteFixtureUser } from "./lib/fixtureUser.mjs";
import { randomUUID } from "node:crypto";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const requiredTables = ["tenant_queue_sla_settings", "tenant_lead_sla_events"];
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures += 1; } };

for (const table of requiredTables) {
  const result = await db.from(table).select("*").limit(1);
  check(`${table} exists in connected Supabase`, !result.error, result.error?.message);
}
if (failures) { console.log("\nLA-1.23 live checks stopped: apply the numbered migration first."); process.exit(1); }

const tenantId = randomUUID();
const oldWorkItem = randomUUID();
const oldLead = randomUUID();
const claimedWorkItem = randomUUID();
const claimedLead = randomUUID();
let userId = null;
let pipelineId = null;
let stageId = null;
async function cleanup() {
  await db.from("tenant_lead_sla_events").delete().eq("tenant_id", tenantId);
  await db.from("lead_queue").delete().eq("tenant_id", tenantId);
  await db.from("agent_leads").delete().eq("tenant_id", tenantId);
  await db.from("tenant_queue_sla_settings").delete().eq("tenant_id", tenantId);
  await db.from("tenant_users").delete().eq("tenant_id", tenantId);
  await deleteFixtureUser(db, userId);
  await db.from("tenants").delete().eq("id", tenantId);
}
try {
  const tenant = await db.from("tenants").insert({ id: tenantId, name: `LA-1.23 QA ${Date.now()}`, status: "active", onboarding_state: "completed" }); if (tenant.error) throw tenant.error;
  ({ userId } = await createFixtureUser(db, { email: `la123-${Date.now()}@invalid.test`, name: "LA-1.23 QA" }));
  const member = await db.from("tenant_users").insert({ tenant_id: tenantId, user_id: userId, role: "owner", accepted_at: new Date().toISOString() }); if (member.error) throw member.error;
  const seeded = await db.rpc("seed_default_pipelines", { p_tenant_id: tenantId }); if (seeded.error) throw seeded.error;
  const pipeline = await db.from("tenant_pipelines").select("id").eq("tenant_id", tenantId).eq("partner_type", "publisher").eq("is_default", true).single(); if (pipeline.error) throw pipeline.error; pipelineId = pipeline.data.id;
  const stage = await db.from("tenant_pipeline_stages").select("id").eq("pipeline_id", pipelineId).eq("is_archived", false).order("position").limit(1).single(); if (stage.error) throw stage.error; stageId = stage.data.id;
  const template = await db.from("templates").select("id, version, product_code").eq("is_active", true).limit(1).single(); if (template.error) throw template.error;
  const settings = await db.rpc("update_tenant_queue_sla_settings", { p_tenant_id: tenantId, p_actor: userId, p_warn: 1, p_escalate: 2, p_partner: 3, p_expire: 4 }); if (settings.error) throw settings.error;
  // run_unclaimed_sla selects `where status = 'unclaimed' order by queued_at asc limit N` with no
  // tenant filter, so it works the oldest rows in the WHOLE table. A fixture queued ten seconds ago
  // sorts last, and at the time of writing 1,502 unclaimed rows sat ahead of it -- so the scheduler
  // never reached this lead and all four rungs read zero, which looks exactly like a broken ladder.
  //
  // Queue it in the past so it sorts first and the ladder is deterministic regardless of what else is
  // in the table. That is also the honest fixture: this task is about a lead that SAT unclaimed.
  //
  // The starvation this works around is a real property of the scheduler, not a test artifact --
  // see backlog 186.
  const oldAt = new Date("2020-01-01T00:00:00.000Z").toISOString();
  const leads = await db.from("agent_leads").insert([{ id: oldLead, tenant_id: tenantId, template_id: template.data.id, template_version: template.data.version, product_line: template.data.product_code, pipeline_id: pipelineId, stage_id: stageId, values: { full_name: "LA-1.23 Old Lead" }, created_by: userId }, { id: claimedLead, tenant_id: tenantId, template_id: template.data.id, template_version: template.data.version, product_line: template.data.product_code, pipeline_id: pipelineId, stage_id: stageId, values: { full_name: "LA-1.23 Claimed Lead" }, created_by: userId }]); if (leads.error) throw leads.error;
  const queues = await db.from("lead_queue").insert([{ id: oldWorkItem, tenant_id: tenantId, lead_id: oldLead, product_line: template.data.product_code, pipeline_id: pipelineId, stage_id: stageId, status: "unclaimed", queued_at: oldAt }, { id: claimedWorkItem, tenant_id: tenantId, lead_id: claimedLead, product_line: template.data.product_code, pipeline_id: pipelineId, stage_id: stageId, status: "claimed", claimed_by: userId, claimed_at: oldAt, queued_at: oldAt }]); if (queues.error) throw queues.error;
  const first = await db.rpc("run_unclaimed_sla", { p_now: new Date().toISOString(), p_limit: 100 }); if (first.error) throw first.error;
  const second = await db.rpc("run_unclaimed_sla", { p_now: new Date().toISOString(), p_limit: 100 }); if (second.error) throw second.error;
  const events = await db.from("tenant_lead_sla_events").select("work_item_id, rung").eq("tenant_id", tenantId).eq("work_item_id", oldWorkItem); if (events.error) throw events.error;
  const counts = Object.fromEntries(["warn", "escalate", "partner", "expire"].map((rung) => [rung, (events.data ?? []).filter((row) => row.rung === rung).length]));
  check("all four rungs fire once on first run and stay once on second run", Object.keys(counts).length === 4 && Object.values(counts).every((count) => count === 1), JSON.stringify(counts));
  const claimed = await db.from("lead_queue").select("status, sla_expired_at").eq("id", claimedWorkItem).single(); check("claimed lead is never expired by scheduler", claimed.data?.status === "claimed" && claimed.data.sla_expired_at === null);


  // Criterion 6 is "the job reports what it did". run_unclaimed_sla RETURNS TABLE of the events it
  // created, and the suite was discarding it -- so the ladder was verified by reading the table
  // afterwards, which proves the rows exist but not that the scheduler reported them. An operator
  // watching a scheduled job sees the return value, not the table.
  const reported = (first.data ?? []).filter((row) => row.work_item_id === oldWorkItem).map((row) => row.rung).sort();
  check("the job reports the rungs it fired", reported.join(",") === "escalate,expire,partner,warn", JSON.stringify({ reported, secondRunReported: (second.data ?? []).filter((row) => row.work_item_id === oldWorkItem).length }));

  // ...and the second run must report nothing for this lead. Criterion 1 is about the rungs firing
  // once; this is the reporting half of the same guarantee -- a job that re-reports work it did not
  // do would drive duplicate alerts even with the table correct.
  check("the second run reports no repeat work", (second.data ?? []).filter((row) => row.work_item_id === oldWorkItem).length === 0);

  // Criterion 2 is "claiming at any point stops the WHOLE ladder immediately". The check below covers
  // expiry, which is criterion 3. The ladder has four rungs, and a claimed lead must collect none of
  // them -- not merely avoid the last one.
  const claimedEvents = await db.from("tenant_lead_sla_events").select("rung").eq("work_item_id", claimedWorkItem);
  const claimedMarkers = await db.from("lead_queue").select("sla_warned_at, sla_escalated_at, sla_partner_notified_at, sla_expired_at").eq("id", claimedWorkItem).single();
  check("claiming stops every rung, not just expiry", (claimedEvents.data ?? []).length === 0 && Object.values(claimedMarkers.data ?? {}).every((value) => value === null), JSON.stringify({ events: (claimedEvents.data ?? []).map((row) => row.rung), markers: claimedMarkers.data }));  // Criterion 5 is "changing a threshold takes effect without a deploy". The settings were written
  // once at setup, so nothing so far distinguishes "the scheduler read the configured thresholds"
  // from "the scheduler used its defaults and the lead was old enough for both". This lead is dated
  // 2020, so every default threshold is long past too -- which is exactly why the negative case is
  // the one worth testing.
  //
  // Raise the thresholds beyond the lead's age, between two runs of the same unchanged job, and the
  // ladder must go quiet. Nothing is redeployed; only a row changes.
  const laterLead = randomUUID(); const laterWorkItem = randomUUID();
  const newLead = await db.from("agent_leads").insert({ id: laterLead, tenant_id: tenantId, template_id: template.data.id, template_version: template.data.version, product_line: template.data.product_code, pipeline_id: pipelineId, stage_id: stageId, values: { full_name: "LA-1.23 Threshold Lead" }, created_by: userId });
  if (newLead.error) throw newLead.error;
  // Three days old: older than every other unclaimed row in the table, so the scheduler reaches it,
  // but young enough to sit under a threshold. update_tenant_queue_sla_settings caps expire at
  // 604800 seconds (7 days), so the 2020 fixture above could never be put back under any legal
  // threshold -- which is why this one is dated separately rather than reusing oldAt.
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const newQueue = await db.from("lead_queue").insert({ id: laterWorkItem, tenant_id: tenantId, lead_id: laterLead, product_line: template.data.product_code, pipeline_id: pipelineId, stage_id: stageId, status: "unclaimed", queued_at: threeDaysAgo });
  if (newQueue.error) throw newQueue.error;
  // 4, 5, 6 and 7 days -- every rung now sits beyond this lead's three-day age, in the ascending
  // order the settings constraint requires, and within the 7-day ceiling the setter enforces.
  const raised = await db.rpc("update_tenant_queue_sla_settings", { p_tenant_id: tenantId, p_actor: userId, p_warn: 345600, p_escalate: 432000, p_partner: 518400, p_expire: 604800 });
  if (raised.error) throw raised.error;
  const afterRaise = await db.rpc("run_unclaimed_sla", { p_now: new Date().toISOString(), p_limit: 100 });
  if (afterRaise.error) throw afterRaise.error;
  const quiet = await db.from("tenant_lead_sla_events").select("rung").eq("work_item_id", laterWorkItem);
  const stillUnclaimed = await db.from("lead_queue").select("status").eq("id", laterWorkItem).single();
  check("raising a threshold takes effect on the next run with no deploy", (quiet.data ?? []).length === 0 && stillUnclaimed.data?.status === "unclaimed", JSON.stringify({ rungs: (quiet.data ?? []).map((row) => row.rung), status: stillUnclaimed.data?.status }));

  // Criterion 4 is "expired leads are readable AND reopenable". Reopening is asserted below; this is
  // the readable half, and it is the one worth stating because expiry is the hygiene mechanism -- the
  // whole point is that it takes the row out of the ACTIVE queue without taking it out of the record.
  // A lead that vanished on expiry would still satisfy every other criterion here.
  const expiredRow = await db.from("lead_queue").select("id, lead_id, status, queued_at, sla_expired_at").eq("id", oldWorkItem).maybeSingle();
  const expiredLead = await db.from("agent_leads").select("id, values").eq("id", oldLead).maybeSingle();
  check("an expired lead is still fully readable", expiredRow.data?.status === "expired" && Boolean(expiredRow.data?.sla_expired_at) && expiredLead.data?.values?.full_name === "LA-1.23 Old Lead", JSON.stringify({ queue: expiredRow.data?.status, lead: expiredLead.data?.values?.full_name ?? "gone" }));

  const reopened = await db.rpc("reopen_expired_lead", { p_tenant_id: tenantId, p_work_item_id: oldWorkItem, p_actor: userId }); check("expired lead can be reopened", !reopened.error && reopened.data?.status === "unclaimed", reopened.error?.message);
  const duplicate = await db.rpc("reopen_expired_lead", { p_tenant_id: tenantId, p_work_item_id: oldWorkItem, p_actor: userId }); check("reopening twice is idempotent", !duplicate.error && duplicate.data?.duplicate === true, duplicate.error?.message);
} finally { await cleanup(); }
// Every other suite in this module prints a summary line, and a sweep that greps for one reads this
// suite's silence as "produced no output" rather than "passed".
console.log(failures ? `\n${failures} LA-1.23 check(s) FAILED.` : "\nAll LA-1.23 unclaimed-SLA checks passed.");
process.exit(failures ? 1 : 0);
