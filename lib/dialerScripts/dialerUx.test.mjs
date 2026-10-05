// Run with: npm test
//
// M2 dialer UX (FIX builder D, 2026-09-29): the one outcome vocabulary, keyboard keys, callback
// quick options, rebuttal search, the unapproved-disclosure marker and the empty-queue diagnosis.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { APPLICATION_OUTCOME, dialerVocabulary, FALLBACK_DIALER_OUTCOMES, fallbackOutcomeKeys, INBOUND_RETURN_CALL, outcomeButtonLabel, outcomeHotkey, outcomeIndexForKey, outcomesForRole } from "./outcomes.ts";
import { callbackQuickOptions } from "./callbackQuick.ts";
import { REBUTTAL_OBJECTIONS, searchRebuttals } from "./rebuttals.ts";
import { isPlaceholderDisclosure, unapprovedDisclosureLine } from "./disclosureStatus.ts";
import { dncExemptionLine, durationPhrase, explainEmptyQueue, windowOpeningCandidates } from "./display.ts";
import { dialerSource } from "./dialerSource.mjs";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

// ── the one vocabulary (M1 LA-1.12-4) ────────────────────────────────────────────────────────────
test("the dialer's buttons are the tenant's positioned rows, in position order", () => {
  const rows = [
    { disposition_key: "application_submitted", label: "Application submitted", is_active: true, dialer_position: 4 },
    { disposition_key: "no_answer", label: "No answer", is_active: true, dialer_position: 1 },
    { disposition_key: "busy", label: "Line busy", is_active: true, dialer_position: 6 },
    { disposition_key: "voicemail", label: "Voicemail", is_active: false, dialer_position: 5 },
    { disposition_key: "sent_to_underwriting", label: "Sent to underwriting", is_active: true, dialer_position: null },
    { disposition_key: INBOUND_RETURN_CALL, label: "They rang back", is_active: true, dialer_position: null },
  ];
  const vocabulary = dialerVocabulary(rows);
  assert.equal(vocabulary.source, "tenant");
  // A renamed outcome shows its new label; an archived one is not a button; an unpositioned one is not either.
  assert.deepEqual(vocabulary.outcomes.map((row) => `${row.position}:${row.key}:${row.label}`), ["1:no_answer:No answer", "4:application_submitted:Application submitted", "6:busy:Line busy"]);
  assert.deepEqual(vocabulary.inboundReturnCall, { key: INBOUND_RETURN_CALL, label: "They rang back" });
  assert.equal(vocabulary.labels.sent_to_underwriting, "Sent to underwriting");
  // With the tenant's rows in charge, the route accepts no key without a row.
  assert.deepEqual(fallbackOutcomeKeys(vocabulary), []);
});

test("before the migration (no positioned row) the dialer keeps the list it had", () => {
  for (const rows of [null, [], [{ disposition_key: "call_dropped", label: "Dropped", is_active: true, dialer_position: null }]]) {
    const vocabulary = dialerVocabulary(rows);
    assert.equal(vocabulary.source, "fallback");
    assert.deepEqual(vocabulary.outcomes.map((row) => row.key), FALLBACK_DIALER_OUTCOMES.map((row) => row.key));
    assert.equal(vocabulary.outcomes.length, 10);
    assert.deepEqual(fallbackOutcomeKeys(vocabulary), [...FALLBACK_DIALER_OUTCOMES.map((row) => row.key), INBOUND_RETURN_CALL]);
  }
  // The tenant's own label still names a history row the fallback does not know.
  assert.equal(dialerVocabulary([{ disposition_key: "did_not_qualify", label: "DNQ", is_active: true, dialer_position: null }]).labels.did_not_qualify, "DNQ");
});

test("keys 1-9 then 0 pick the ten outcomes, and a setter has no application", () => {
  assert.deepEqual([0, 1, 8, 9, 10].map(outcomeHotkey), ["1", "2", "9", "0", null]);
  assert.deepEqual(["1", "9", "0", "a", "10"].map(outcomeIndexForKey), [0, 8, 9, null, null]);
  const setter = outcomesForRole(FALLBACK_DIALER_OUTCOMES, true);
  assert.equal(setter.length, 9);
  assert.ok(!setter.some((row) => row.key === APPLICATION_OUTCOME));
  // "Interested – start application" is the application outcome's button (LA-2.9-3).
  assert.equal(outcomeButtonLabel({ key: APPLICATION_OUTCOME, label: "Application submitted", position: 4 }), "Interested – start application");
  assert.equal(outcomeButtonLabel({ key: "no_answer", label: "No answer", position: 1 }), "No answer");
});

test("the application press starts the application when verification is incomplete", () => {
  const workspace = dialerSource();
  assert.match(workspace, /value === APPLICATION_OUTCOME && response\.status === 409 && body\?\.code === "verification_incomplete" && !isSetter\) \{\n\s*await startApplication\(\);/);
  // LA-3's uncommitted edit is kept: the application workspace opens after the start.
  assert.match(workspace, /fetch\("\/api\/app\/applications\/start"/);
  assert.match(workspace, /router\.push\(workspace\?\.href \?\? `\/app\/leads\/\$\{panel\.lead\.id\}`\)/);
});

// ── LA-2.10-1 quick options ──────────────────────────────────────────────────────────────────────
test("quick options sit in the customer's time, inside their window", () => {
  // Tue 29 Sep 2026 18:32 UTC = 11:32 Phoenix (MST, no DST).
  const now = Date.UTC(2026, 8, 29, 18, 32);
  const options = callbackQuickOptions(now, "America/Phoenix", { startHour: 8, endHour: 21, noSunday: false });
  assert.deepEqual(options.map((o) => `${o.key}=${o.local}`), [
    "later_today=2026-09-29T14:00",
    "tomorrow_am=2026-09-30T10:00",
    "tomorrow_pm=2026-09-30T14:00",
    "next_week=2026-10-06T10:00",
  ]);
  // Late in the day there is no "later today": 20:10 local plus two hours is past the window.
  const late = callbackQuickOptions(Date.UTC(2026, 8, 30, 3, 10), "America/Phoenix", { startHour: 8, endHour: 21, noSunday: false });
  assert.ok(!late.some((o) => o.key === "later_today"));
  // A narrow agency window moves the morning option to its opening.
  const narrow = callbackQuickOptions(now, "America/Phoenix", { startHour: 11, endHour: 17, noSunday: false });
  assert.equal(narrow.find((o) => o.key === "tomorrow_am")?.local, "2026-09-30T11:00");
  // A state that bars Sundays: Saturday's "tomorrow" becomes Monday, and says so.
  const saturday = callbackQuickOptions(Date.UTC(2026, 9, 3, 16, 0), "America/New_York", { startHour: 8, endHour: 21, noSunday: true });
  assert.deepEqual(saturday.filter((o) => o.key.startsWith("tomorrow")).map((o) => `${o.label}=${o.local}`), ["Monday morning=2026-10-05T10:00", "Monday afternoon=2026-10-05T14:00"]);
});

test("the dialer's callback panel offers them, a note, and the agent's own clock", () => {
  const workspace = dialerSource();
  assert.match(workspace, /callbackQuickOptions\(Date\.now\(\), customerZone,/);
  assert.match(workspace, /id="callback-note"/);
  assert.match(workspace, /callback_note: callbackNote\.trim\(\)/);
  assert.match(workspace, /const agentZone = panel\?\.viewerTimezone \|\| viewerTimeZone\(\);/);
  assert.match(workspace, /dateTime\(callbackInstant, agentZone, \{ weekday: true, clock: "12h" \}\)\} your time/);
  assert.match(read("lib", "dialerScripts", "service.ts"), /from\("tenant_agent_availability"\)\.select\("timezone"\)/);
});

// ── LA-2.23-3 rebuttal search ────────────────────────────────────────────────────────────────────
test("the rebuttal library is searchable by objection, response or key", () => {
  const items = [
    { id: "1", objectionKey: "how_did_you_get_my_number", label: "How did you get my number?", body: "Your details came with the inquiry." },
    { id: "2", objectionKey: "too_expensive", label: "It's too expensive", body: "We can look at a smaller amount." },
    { id: "3", objectionKey: "talk_to_spouse", label: "I need to talk to my spouse", body: "Shall we set a time when you can both join?" },
  ];
  assert.deepEqual(searchRebuttals(items, "number").map((i) => i.id), ["1"]);
  assert.deepEqual(searchRebuttals(items, "its too").map((i) => i.id), ["2"]);
  assert.deepEqual(searchRebuttals(items, "SPOUSE time").map((i) => i.id), ["3"]);
  assert.deepEqual(searchRebuttals(items, "spouse expensive"), []);
  assert.equal(searchRebuttals(items, "  ").length, 3);
  assert.equal(REBUTTAL_OBJECTIONS.length, 8);
  const constraint = read("supabase", "migrations", "20260929200100_rebuttal_library_two_more_objections.sql");
  for (const key of REBUTTAL_OBJECTIONS) assert.match(constraint, new RegExp(`'${key}'`));
  assert.match(read("app", "api", "app", "dialer", "rebuttals", "route.ts"), /objection_key: z\.enum\(REBUTTAL_OBJECTIONS\)/);
  assert.match(dialerSource(), /aria-label="Search rebuttals"/);
});

// ── D15 · unapproved disclosures ─────────────────────────────────────────────────────────────────
test("the seeded placeholder is recognised as not approved, and nothing else is", () => {
  assert.equal(isPlaceholderDisclosure("[PLACEHOLDER — NOT COMPLIANCE-APPROVED. Replace on /admin/state-disclosures before any live call.]\n\nHello"), true);
  assert.equal(isPlaceholderDisclosure("  [placeholder] x"), true);
  assert.equal(isPlaceholderDisclosure("This call may be recorded. [PLACEHOLDER] later"), false);
  assert.equal(isPlaceholderDisclosure(""), false);
  assert.match(unapprovedDisclosureLine("Arizona"), /^Not compliance-approved: Arizona's disclosure is placeholder text\./);
  assert.match(read("lib", "dialerScripts", "service.ts"), /approved: !isPlaceholderDisclosure\(text\(disclosure\.data\.required_text\)\)/);
  assert.match(dialerSource(), /\{disclosureUnapproved && <div className="mt-4"><Callout tone="warning" title=\{unapprovedDisclosureLine\(/);
});

test("a DNC exemption is shown on the dial with exactly what it clears", () => {
  assert.equal(dncExemptionLine({ basis: "written_consent", expiresAt: null }), "DNC exemption · written consent · clears federal/state DNC");
  assert.equal(dncExemptionLine({ basis: "existing_business_relationship", expiresAt: "2027-03-01T00:00:00Z" }, new Date("2026-09-29T00:00:00Z")), "DNC exemption · existing business relationship · clears federal/state DNC · until 1 Mar 2027");
  assert.match(read("lib", "dialerScripts", "service.ts"), /db\.rpc\("active_dnc_exemption", \{ p_tenant_id: tenantId, p_phone: normalizedPhone \}\)/);
  assert.match(read("lib", "compliance", "dialPreflight.ts"), /p_context: "dial_preflight"/);
  const serve = read("supabase", "migrations", "20260929200200_serve_eligible_honours_dnc_exemptions.sql");
  assert.match(serve, /s\.list_type in \(''federal_dnc'', ''state_dnc''\) and public\.dnc_exemption_active_id\(p_tenant_id, d\.digits, p_now\) is not null/);
});

// ── LA-2.8-6 / LA-2.3-1 · which reason the empty queue has ───────────────────────────────────────
const campaigns = [{ name: "Term A", status: "active", scrubStatus: "scrubbed" }, { name: "FE B", status: "active", scrubStatus: "unscrubbed" }];
const base = { campaigns, anyUnclaimed: true, workableStates: ["AZ", "TX"], windows: [], nextOpening: null, retryWaiting: null, slotWaiting: null, agentZone: "America/New_York", now: Date.UTC(2026, 8, 29, 11, 0) };

test("the scrub is the reason when nothing scrubbed is active", () => {
  const out = explainEmptyQueue({ ...base, campaigns: [{ name: "FE B", status: "active", scrubStatus: "scrubbing" }] });
  assert.equal(out.code, "campaigns");
  assert.match(out.message, /FE B is still being scrubbed/);
});

test("nothing waiting, and no licensed state, are named as such", () => {
  assert.equal(explainEmptyQueue({ ...base, anyUnclaimed: false }).code, "nothing_waiting");
  const unlicensed = explainEmptyQueue({ ...base, workableStates: [] });
  assert.equal(unlicensed.code, "no_licence");
  assert.match(unlicensed.message, /not licensed in any state/);
});

test("every workable state closed: the window, with the next opening in both clocks", () => {
  const windows = [
    { state: "AZ", allowed: false, startMinute: 480, endMinute: 1260, localMinute: 240, zone: "America/Phoenix", reason: "before_open" },
    { state: "TX", allowed: false, startMinute: 480, endMinute: 1260, localMinute: 360, zone: "America/Chicago", reason: "before_open" },
  ];
  const candidates = windowOpeningCandidates(windows, base.now);
  // 11:00 UTC: TX (CDT) opens 13:00 UTC, AZ (MST) 15:00 UTC.
  assert.equal(candidates[0].state, "TX");
  assert.equal(new Date(candidates[0].at).toISOString(), "2026-09-29T13:00:00.000Z");
  const out = explainEmptyQueue({ ...base, windows, nextOpening: candidates[0] });
  assert.equal(out.code, "window");
  assert.match(out.message, /^Outside the calling window: every state you are licensed in \(AZ and TX\) is closed right now\. The next to open is TX, at 8:00 AM CT \(9:00 AM your time\), in 2 hours\./);
  // And the scrub-held campaign is still named.
  assert.match(out.message, /Held back until their scrub passes: FE B has not been scrubbed/);
  assert.equal(explainEmptyQueue({ ...base, windows: [{ ...windows[0], reason: "rules_stale" }] }).code, "rules_stale");
});

test("after close, the next opening is tomorrow's start, confirmed by the caller", () => {
  const evening = Date.UTC(2026, 8, 30, 3, 0); // 22:00 CDT on the 29th
  const [first] = windowOpeningCandidates([{ state: "TX", allowed: false, startMinute: 480, endMinute: 1260, localMinute: 1320, zone: "America/Chicago", reason: "after_close" }], evening);
  assert.equal(new Date(first.at).toISOString(), "2026-09-30T13:00:00.000Z");
  assert.deepEqual(windowOpeningCandidates([{ state: "TX", allowed: false, startMinute: null, endMinute: null, localMinute: null, zone: "America/Chicago", reason: "no_window" }], evening), []);
});

test("windows open: retry timers, then untried slots, then the residue", () => {
  const open = [{ state: "AZ", allowed: true, startMinute: 480, endMinute: 1260, localMinute: 600, zone: "America/Phoenix", reason: "open" }, { state: "TX", allowed: false, startMinute: 480, endMinute: 1260, localMinute: 1300, zone: "America/Chicago", reason: "after_close" }];
  const retry = explainEmptyQueue({ ...base, windows: open, retryWaiting: { count: 42, nextAt: "2026-09-29T11:40:00Z" }, slotWaiting: 3 });
  assert.equal(retry.code, "retry");
  assert.match(retry.message, /42 leads are waiting on a retry timer; the next is due at 7:40 AM your time, in 40 minutes\. 3 retry leads are due but wait for a time slot they have not been tried in\. Leads in TX wait for their calling window\. You are served AZ and TX leads only/);
  assert.equal(explainEmptyQueue({ ...base, windows: open, retryWaiting: { count: 0, nextAt: null }, slotWaiting: 2 }).code, "slot");
  const residue = explainEmptyQueue({ ...base, windows: open, retryWaiting: { count: 0, nextAt: null }, slotWaiting: 0 });
  assert.equal(residue.code, "normal");
  assert.doesNotMatch(residue.message, /waiting on a retry timer/, "the residue no longer lists reasons it has ruled out");
  assert.equal(durationPhrase(125), "2 hours 5 minutes");
});

test("attempt N of M reads the cadence's ceiling, with the lead's own ceiling winning", () => {
  const service = read("lib", "dialerScripts", "service.ts");
  assert.match(service, /db\.rpc\("cadence_max_attempts", \{ p_tenant_id: tenantId, p_campaign_id: campaignId \}\)/);
  assert.match(service, /attemptCeiling: numberOrNull\(leadResult\.data\.attempt_ceiling\) \?\? cadenceCeiling,/);
  // Before 20260929201100 the read fails as pending schema and the default seven applies.
  assert.match(service, /if \(!isPendingSchema\(result\.error\)\) console\.error\(`\[dialer\] cadence_max_attempts failed/);
});
