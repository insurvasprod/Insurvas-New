/**
 * Lead posting round 8 (option A): a vendor's status, posting hours, the "today" boundary, refused
 * leads named without their details, money in dollars, the status-callback address check, and the
 * vendor guide built from the field map.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  callbackUrlProblem,
  centsFromInput,
  describeHours,
  dollars,
  fixForReason,
  leadLabel,
  readPostingHours,
  startOfDayIn,
  statusInFilter,
  vendorStatus,
  withinPostingHours,
} from "./board.ts";
import { guideRows, guideText, samplePayload } from "./guide.ts";

const counts = (posts, accepted = posts) => ({ posts, accepted, refused: posts - accepted, tests: 0 });
const base = { hasActiveKey: true, testMode: false, campaignServable: true, everPosted: true, week: counts(10), weekReasons: [], unreadGuesses: 0 };

test("a vendor's status, in the board's order", () => {
  assert.equal(vendorStatus({ ...base, hasActiveKey: false }).status, "revoked");
  assert.equal(vendorStatus({ ...base, testMode: true }).status, "testing");
  assert.equal(vendorStatus({ ...base, campaignServable: false }).status, "paused");
  assert.deepEqual(vendorStatus({ ...base, unreadGuesses: 2 }), { status: "needs_you", needsYou: "2 fields" });
  assert.deepEqual(vendorStatus({ ...base, week: counts(31, 22), weekReasons: [{ reasonCode: "invalid_phone", count: 9 }] }), { status: "needs_you", needsYou: "phone" });
  // The scrub doing its job is not something the owner must fix.
  assert.equal(vendorStatus({ ...base, week: counts(10, 5), weekReasons: [{ reasonCode: "suppressed_dnc", count: 5 }] }).status, "live");
  assert.equal(vendorStatus({ ...base, everPosted: false, week: counts(0) }).status, "waiting");
  assert.equal(vendorStatus(base).status, "live");
});

test("the table's filter groups statuses as the board does", () => {
  assert.ok(statusInFilter("revoked", "off"));
  assert.ok(statusInFilter("paused", "off"));
  assert.ok(statusInFilter("waiting", "testing"));
  assert.ok(!statusInFilter("live", "needs_you"));
});

test("posting hours: days and a window in the vendor's zone; none means any time", () => {
  const hours = { days: [1, 2, 3, 4, 5, 6], start: "08:00", end: "20:00", timeZone: "America/Chicago" };
  // Monday 2026-11-09 15:00 UTC is 9:00 am in Chicago.
  assert.equal(withinPostingHours(hours, new Date("2026-11-09T15:00:00Z")), true);
  // 7:00 am Chicago.
  assert.equal(withinPostingHours(hours, new Date("2026-11-09T13:00:00Z")), false);
  // Sunday.
  assert.equal(withinPostingHours(hours, new Date("2026-11-08T18:00:00Z")), false);
  assert.equal(withinPostingHours(null, new Date()), true);
  // An overnight window wraps past midnight.
  assert.equal(withinPostingHours({ ...hours, days: [0, 1, 2, 3, 4, 5, 6], start: "22:00", end: "06:00" }, new Date("2026-11-09T09:00:00Z")), true);
  assert.equal(describeHours(hours), "Mon–Sat · 8 am – 8 pm");
  assert.equal(readPostingHours({ days: [], start: "08:00", end: "20:00" }), null);
  assert.equal(readPostingHours("nonsense"), null);
});

test("today starts at the viewer's midnight", () => {
  const start = startOfDayIn("America/Chicago", new Date("2026-11-12T03:30:00Z"));
  // 03:30 UTC on the 12th is 9:30 pm on the 11th in Chicago (CST, UTC-6).
  assert.equal(start.toISOString(), "2026-11-11T06:00:00.000Z");
});

test("a refused lead is named by first name, last initial and state only", () => {
  assert.equal(leadLabel({ first_name: "Martha", last_name: "Reyes", state: "tx", phone: "5125550142" }), "Martha R. · TX");
  assert.equal(leadLabel({ full_name: "Earl Dean Davis", state: "OH" }), "Earl D. · OH");
  assert.equal(leadLabel({}), "No name");
});

test("money is dollars and cents, never cents", () => {
  assert.equal(dollars(2200), "$22.00");
  assert.equal(dollars(null), "—");
  assert.equal(centsFromInput("$15.00"), 1500);
  assert.equal(centsFromInput(""), null);
  assert.ok(Number.isNaN(centsFromInput("fifteen")));
});

test("the status callback goes only to a public https address", () => {
  assert.equal(callbackUrlProblem("https://partners.smartfinancial.com/insurvas/status"), null);
  assert.ok(callbackUrlProblem("http://partners.example.com"));
  assert.ok(callbackUrlProblem("https://localhost/x"));
  assert.ok(callbackUrlProblem("https://192.168.1.4/x"));
  assert.ok(callbackUrlProblem("https://10.0.0.1/x"));
  assert.ok(callbackUrlProblem("https://intranet/x"));
});

test("each refusal has one fix, or says there is nothing to fix", () => {
  assert.equal(fixForReason("invalid_phone", null).kind, "map");
  assert.equal(fixForReason("state_not_licensed", null).kind, "licence");
  assert.equal(fixForReason("missing_consent_text", null).kind, "tell");
  assert.equal(fixForReason("suppressed_dnc", null).kind, "none");
  assert.equal(fixForReason("campaign_not_accepting", "c1").kind === "campaign" && fixForReason("campaign_not_accepting", "c1").href, "/app/campaigns/c1");
});

test("the vendor guide uses their field names where the map says so", () => {
  const map = { phone: "ph_home", first_name: "fname", state: "st" };
  const rows = guideRows({ fieldMap: map });
  assert.equal(rows[0].field, "ph_home");
  assert.equal(rows[1].field, "st");
  assert.equal(rows[2].field, "fname, last_name");
  assert.deepEqual(Object.keys(samplePayload(map)).slice(0, 3), ["fname", "last_name", "ph_home"]);
  const text = guideText({ agencyName: "Ellery & Fields", vendorName: "QuoteWizard", postingUrl: "https://app.example.com/api/post/abc", fieldMap: map });
  assert.match(text, /^Posting leads to Ellery & Fields/);
  assert.match(text, /POST https:\/\/app\.example\.com\/api\/post\/abc/);
  // The guide never carries a key.
  assert.match(text, /Bearer <your key>/);
  assert.equal(guideRows({ formQuestions: [{ key: "coverage_amount", label: "Coverage wanted", theirs: "coverage_amt" }] }).at(-1).field, "coverage_amt");
});

test("the post path honours test mode, the cap, the hours and the grace window, and reports the callback after replying", async () => {
  const service = await readFile(new URL("./service.ts", import.meta.url), "utf8");
  const handler = await readFile(new URL("./postHandler.ts", import.meta.url), "utf8");
  assert.match(service, /grace_until > new Date\(\)\.toISOString\(\)/);
  assert.match(service, /if \(testMode\) \{/);
  assert.match(service, /reasonCode: "daily_cap_reached"/);
  assert.match(service, /reasonCode: "outside_posting_hours"/);
  assert.match(service, /is_test: true/);
  assert.match(handler, /after\(\(\) => sendStatusCallback\(callback\)\)/);
});
