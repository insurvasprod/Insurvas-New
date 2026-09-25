// Run with: npm test
//
// The dialer board's wording of server facts, and the two server-side copies it relies on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { attemptOfCeiling, capacityEmptyReason, consentLabel, costPerLeadLabel, DIAL_ATTEMPT_CEILING, DIAL_SLOTS, formatUsPhone, minuteLabel, pickRefusalMessage, returnWindowLine, selectionReasonParts, slotsTried, sourceLabel, suppressionRefusal, windowClosedLabel, zoneShort } from "./display.ts";

const ROOT = process.cwd();
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function latestBody(name) {
  const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).sort();
  for (let index = files.length - 1; index >= 0; index -= 1) {
    const text = readFileSync(join(MIGRATIONS, files[index]), "utf8");
    const start = text.indexOf(`create or replace function public.${name}(`);
    if (start >= 0) return { file: files[index], body: text.slice(start, text.indexOf("$function$;", text.indexOf("$function$", start) + 10)) };
  }
  return null;
}

test("the identity line reads like the board", () => {
  assert.equal(formatUsPhone("+13125550148"), "(312) 555–0148");
  assert.equal(formatUsPhone("3125550148"), "(312) 555–0148");
  assert.equal(formatUsPhone("12345"), "12345");
  assert.equal(zoneShort("America/Chicago"), "CT");
  assert.equal(zoneShort("America/New_York"), "ET");
  assert.equal(minuteLabel(1200), "8:00 PM");
  assert.equal(minuteLabel(480), "8:00 AM");
  assert.equal(minuteLabel(0), "12:00 AM");
});

test("source is the campaign's lead type, and absence is a dash", () => {
  assert.equal(sourceLabel("list"), "List import");
  assert.equal(sourceLabel("realtime"), "Real-time post");
  assert.equal(sourceLabel("aged"), "Aged");
  assert.equal(sourceLabel(null), "—");
});

test("consent names its provider, or says there is none", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  assert.equal(consentLabel({ hasCertificate: true, provider: "trustedform", consentTimestamp: "2026-09-12T15:00:00Z", status: "captured" }, now), "Yes · TrustedForm, 12 Sep");
  assert.equal(consentLabel({ hasCertificate: false, provider: null, consentTimestamp: null, status: null }, now), "None on file");
});

test("a closed window and a refused pick each say why", () => {
  assert.match(windowClosedLabel("before_open", 480, "America/Chicago"), /opens 8:00 AM CT/);
  assert.match(windowClosedLabel("rules_stale", null, null), /out of date/);
  assert.match(pickRefusalMessage("taken"), /Another agent/);
  assert.match(pickRefusalMessage("suppressed:internal"), /do-not-call/);
  assert.match(pickRefusalMessage("not_licensed"), /licensed/);
});

test("the window explainer is a copy of tenant_can_dial_now's current rules, and is checked against it", () => {
  // DUPLICATION, flagged: tenant_dial_window restates tenant_can_dial_now's layers because that
  // function belongs to another session's work and is not redefined here. The migration's own
  // assertion compares the two over every state and two instants an hour for eight days; this
  // pins that the copy carries every layer of the latest tenant_can_dial_now, so a new layer added
  // there fails here until the explainer learns it.
  const decide = latestBody("tenant_can_dial_now");
  const explain = latestBody("tenant_dial_window");
  assert.ok(decide && explain);
  for (const layer of ["calling_window_rules_stale", "state_timezones", "calling_window_rules_in_force", "calling_window_holidays", "tenant_calling_windows", "tenant_calling_window_options", "campaign_overrides_enabled", "no_federal_holidays", "tenant_campaigns"]) {
    assert.ok(decide.body.includes(layer), `tenant_can_dial_now no longer reads ${layer}; revisit the explainer`);
    assert.ok(explain.body.includes(layer), `tenant_dial_window does not read ${layer}`);
  }
  // The three 20260924230100 corrections, in the copy too.
  assert.match(explain.body, /v_local timestamp;/);
  assert.match(explain.body, /c\.id = p_campaign_id and c\.tenant_id = p_tenant_id/);
  assert.match(explain.body, /h\.state_code in \('\*', upper\(p_state\)\)/);
  const migration = read("supabase", "migrations", explain.file);
  assert.match(migration, /tenant_dial_window disagrees with tenant_can_dial_now/);
  // The dial still asks tenant_can_dial_now; the explainer only words the answer.
  assert.match(read("lib", "dialerScripts", "service.ts"), /db\.rpc\("tenant_can_dial_now"/);
});

test("the DNC row says what was looked up, not that a vendor exists", () => {
  const workspace = read("components", "app", "dialer-workspace.tsx");
  assert.doesNotMatch(workspace, /DNC status/, "the vendor-health chip is back");
  assert.match(workspace, /Checked when you call/);
  const service = read("lib", "dialerScripts", "service.ts");
  const click = service.slice(service.indexOf("export async function markDialClicked"));
  assert.match(click.slice(0, 2500), /logDncCheck\(db/);
  assert.match(service, /from\("tenant_dial_dnc_checks"\)\.select\("result, checked_at"\)/);
});

test("do not call is offered, confirmed first, and goes through the internal-DNC path", () => {
  const route = read("app", "api", "app", "dialer", "attempt", "[id]", "disposition", "route.ts");
  assert.match(route, /"do_not_call"/);
  const workspace = read("components", "app", "dialer-workspace.tsx");
  assert.match(workspace, /if \(value === "do_not_call"\) \{ setPendingCallback\(false\); setPendingDnc\(true\); return; \}/);
  const complete = latestBody("complete_existing_dial_disposition");
  assert.match(complete.body, /if p_disposition = 'do_not_call' then/);
  assert.match(complete.body, /suppress_phone\(p_tenant_id, v_phone, 'internal'/);
});

test("script and rebuttal authoring is owners and producers", () => {
  for (const path of [["app", "api", "app", "dialer", "scripts", "route.ts"], ["app", "api", "app", "dialer", "rebuttals", "route.ts"]]) {
    const source = read(...path);
    assert.match(source, /const AUTHOR_ROLES: readonly string\[\] = \["owner", "producer"\]/);
    assert.match(source, /if \(!AUTHOR_ROLES\.includes\(auth\.context\.role\)\) return NextResponse\.json/);
  }
  assert.match(read("components", "app", "dialer-workspace.tsx"), /const canAuthor = !readOnly && !isSetter/);
});

test("attempt N of M is the scheduler's own ceiling: the lead's, else the default", () => {
  // schedule_next_attempt stops at coalesce(the lead's attempt_ceiling, 7) (20260925706600). The
  // card's "of M" must be that number, not a guess: both the default and the per-lead read are pinned.
  const scheduler = latestBody("schedule_next_attempt");
  assert.ok(scheduler, "schedule_next_attempt has no definition");
  assert.match(scheduler.body, new RegExp(`v_ceiling integer := ${DIAL_ATTEMPT_CEILING};`));
  assert.match(scheduler.body, /v_ceiling := coalesce\(v_lead_ceiling, v_ceiling\)/);
  assert.match(scheduler.body, /attempt_ceiling/);
  assert.match(scheduler.body, /if v_made >= v_ceiling then/);
  assert.equal(attemptOfCeiling(2), "Attempt 3 of 7");
  assert.equal(attemptOfCeiling(2, null), "Attempt 3 of 7");
  assert.equal(attemptOfCeiling(2, 3), "Attempt 3 of 3");
  assert.equal(attemptOfCeiling(3, 3), "Attempt 4");
  assert.equal(attemptOfCeiling(7), "Attempt 8");
  // The panel reads the lead's own ceiling and hands it to the card.
  const service = read("lib", "dialerScripts", "service.ts");
  assert.match(service, /attempt_ceiling`\)/);
  assert.match(service, /attemptCeiling: numberOrNull\(leadResult\.data\.attempt_ceiling\)/);
  assert.match(read("components", "app", "dialer-workspace.tsx"), /attemptOfCeiling\(panel\.lead\.attemptsMade \?\? 0, panel\.lead\.attemptCeiling\)/);
});

test("the wrong-number line follows Vendor returns' disposition branch, which re-screens never touch", () => {
  // 20260925707900 excludes a later re-scrub's hit and a nurture re-screen's DNC from the SCRUB
  // branch only; a wrong number / disconnected claim is unchanged. lead_return_window answers that
  // claim, so it must not grow either exclusion, or the dialer would say "not claimable" where
  // Vendor returns offers the lead.
  const window = latestBody("lead_return_window");
  assert.doesNotMatch(window.body, /source_key like 'scrub:%'/);
  assert.doesNotMatch(window.body, /tenant_nurture_reactivations/);
  assert.match(window.body, /ri\.scrub_rejection_id/, "the import-removal claim check was dropped");
});

test("due callbacks: tier 2 is callback_tier_due and the holder is asked first, in every serving body", () => {
  for (const name of ["serve_next_lead", "serve_lead_by_id", "dialer_queue_preview", "scoring_queue_preview"]) {
    const fn = latestBody(name);
    assert.ok(fn, `${name} has no definition`);
    assert.match(fn.body, /public\.callback_tier_due\(p_tenant_id, q\.id, v_now\) then 2/, `${name}: tier 2 is not callback_tier_due`);
    assert.doesNotMatch(fn.body, /from tenant_callbacks cb/, `${name}: tier 2 still reads tenant_callbacks`);
    assert.doesNotMatch(fn.body, /[^,] lead_queue_assignee\(p_tenant_id, (q|v_q)\.id\) (=|is distinct)/, `${name}: an assignee comparison skips the callback holder`);
  }
  // Both reclaim steps keep a held callback with its agent rather than setting it unclaimed.
  for (const name of ["serve_next_lead", "serve_lead_by_id"]) {
    const body = latestBody(name).body;
    assert.match(body, /coalesce\(public\.callback_work_item_holder\(p_tenant_id, q\.id\), lead_queue_assignee\(p_tenant_id, q\.id\)\) = q\.owner_user_id/);
    assert.match(body, /coalesce\(public\.callback_work_item_holder\(p_tenant_id, q\.id\), lead_queue_assignee\(p_tenant_id, q\.id\)\) is distinct from q\.owner_user_id/);
  }
});

test("the slot names are current_slot_for_state's, and a slot counts only once it was dialled", () => {
  const slots = latestBody("current_slot_for_state");
  for (const slot of DIAL_SLOTS) assert.match(slots.body, new RegExp(`'${slot}'`), `${slot} is not a slot the database returns`);
  const facts = slotsTried([
    { slot: "late_morning", attemptedAt: "2026-09-22T16:10:00Z", disposition: "no_answer", dialClicked: true },
    { slot: "afternoon", attemptedAt: "2026-09-23T19:00:00Z", disposition: null, dialClicked: false },
  ]);
  assert.deepEqual(facts.tried.map((row) => row.slot), ["late_morning"]);
  assert.ok(facts.untried.includes("afternoon"), "an attempt that was never dialled is not a try");
});

test("a stored suppression hit is refused by name, the litigator list first", () => {
  assert.match(suppressionRefusal(["tcpa_litigator"]), /TCPA litigator list/);
  assert.match(suppressionRefusal(["federal_dnc", "state_dnc"]), /Federal DNC list and the State DNC list/);
  const hits = latestBody("tenant_phone_suppression_hits");
  assert.ok(hits, "tenant_phone_suppression_hits is gone");
  assert.match(hits.body, /from public\.tenant_suppression_list/);
  assert.match(hits.body, /from public\.tenant_do_not_call/);
  const service = read("lib", "dialerScripts", "service.ts");
  assert.match(service, /db\.rpc\("tenant_phone_suppression_hits"/);
  assert.match(service, /blocked\("list_suppressed", suppressionRefusal\(/);
});

test("the wrong-number confirm line says whether the lead can go back, and why not", () => {
  assert.match(returnWindowLine({ vendorName: "DataLeads", campaignName: null, daysRemaining: 11, claimableUntil: null, claimable: true, reason: null }), /Claimable from DataLeads · 11 days left/);
  assert.match(returnWindowLine({ vendorName: null, campaignName: null, daysRemaining: null, claimableUntil: null, claimable: false, reason: "no_campaign" }), /^Not claimable: /);
  assert.match(returnWindowLine(null), /^Not claimable: /);
  const route = read("app", "api", "app", "dialer", "attempt", "[id]", "disposition", "route.ts");
  assert.match(route, /"wrong_number", "disconnected"/);
});

test("capacity: Serve next and the pick leave the pool alone at the ceiling, and say so", () => {
  const serve = latestBody("serve_next_lead");
  assert.equal((serve.body.match(/q\.status <> 'unclaimed' or v_pool_ok/g) ?? []).length, 2, "the capacity predicate is not on both candidate paths");
  assert.match(latestBody("serve_lead_by_id").body, /'at_capacity'/);
  assert.match(pickRefusalMessage("at_capacity"), /open-lead limit/);
  assert.match(capacityEmptyReason(25, 25), /25 open leads and your limit is 25/);
  assert.match(read("app", "api", "app", "dialer", "next", "route.ts"), /capacityEmptyReason\(atCapacity\.open, atCapacity\.max\)/);
});

test("the reason list, cost per lead and the dialer callback's window check", () => {
  assert.deepEqual(selectionReasonParts("Due for a retry, in a slot it has not been tried in — attempt 3 of 7; never tried in the afternoon slot"), ["Due for a retry, in a slot it has not been tried in", "Attempt 3 of 7", "Never tried in the afternoon slot"]);
  assert.equal(costPerLeadLabel(36), "$0.36 / lead");
  assert.equal(costPerLeadLabel(null), "—");
  const callback = latestBody("complete_dial_disposition_with_callback");
  assert.match(callback.body, /assert_callback_in_window\(p_tenant_id, v_attempt\.lead_id, v_scheduled_at\)/);
  const service = read("lib", "dialerScripts", "service.ts");
  assert.match(service, /CALLBACK_OUTSIDE_WINDOW/);
  assert.match(service, /CALLBACK_NO_STATE/);
  // A click-time refusal leaves the same audit row the attempt route writes.
  assert.match(service, /recordDialRefused\(\{ tenantId: input\.tenantId, leadId, actorId: input\.agentId, reason: error\.code, message: error\.message, inbound \}\)/);
});
