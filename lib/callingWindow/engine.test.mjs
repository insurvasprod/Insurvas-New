// Run with: npm test
//
// LA-2.4's criteria are almost all about REFUSING to dial, so most of these assert a refusal. A
// calling-window engine that only proves it can say yes has proven the expensive half wrong.
import { test } from "node:test";
import assert from "node:assert/strict";

import { canDialNow, narrow, isClosed, localPartsIn, FEDERAL_WINDOW } from "./engine.ts";
import { STATE_TIMEZONES } from "../callbacks/timezone.ts";

const tz = STATE_TIMEZONES;

/** An instant expressed in a zone, so the tests read as wall-clock rather than as UTC arithmetic. */
const at = (iso) => new Date(iso);

const dial = (overrides = {}) =>
  canDialNow({ state: "NY", at: at("2026-06-10T15:00:00Z"), timezones: tz, ...overrides });

// ── the narrowing property ───────────────────────────────────────────────────

test("narrow takes the later start and the earlier end", () => {
  assert.deepEqual(narrow({ startHour: 8, endHour: 21 }, { startHour: 9, endHour: 20 }), { startHour: 9, endHour: 20 });
});

test("a wider candidate cannot widen — this is the whole safety property", () => {
  // 6:00-23:00 is wider than federal at both ends. It must change nothing.
  assert.deepEqual(narrow(FEDERAL_WINDOW, { startHour: 6, endHour: 23 }), FEDERAL_WINDOW);
});

test("narrowing is commutative, so layer order cannot change the answer", () => {
  const a = { startHour: 9, endHour: 20 };
  const b = { startHour: 10, endHour: 19 };
  assert.deepEqual(narrow(narrow(FEDERAL_WINDOW, a), b), narrow(narrow(FEDERAL_WINDOW, b), a));
});

test("a window narrowed out of existence permits nothing", () => {
  assert.equal(isClosed(narrow({ startHour: 8, endHour: 21 }, { startHour: 21, endHour: 8 })), true);
});

// ── a lead with no state is not dialable ─────────────────────────────────────

test("a lead with no state is refused, never defaulted to Eastern", () => {
  const decision = dial({ state: null });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "no_state");
  assert.equal(decision.timezone, null);
  assert.match(decision.message, /no state/i);
});

test("an empty or whitespace state is the same as none", () => {
  assert.equal(dial({ state: "" }).reason, "no_state");
  assert.equal(dial({ state: "   " }).reason, "no_state");
});

test("a state we have no timezone for is refused rather than guessed", () => {
  const decision = dial({ state: "ZZ" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "unknown_state");
});

// ── federal hours, in the customer's local time ──────────────────────────────

test("11:00 in New York is inside the federal window", () => {
  const decision = dial({ at: at("2026-06-10T15:00:00Z") }); // 11:00 EDT
  assert.equal(decision.allowed, true);
  assert.equal(decision.localHour, 11);
});

test("07:00 local is before the federal window and is refused", () => {
  const decision = dial({ at: at("2026-06-10T11:00:00Z") }); // 07:00 EDT
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "outside_window");
  assert.match(decision.message, /07:00/);
});

test("21:00 local is outside — the window is half-open, so 9pm is already too late", () => {
  const decision = dial({ at: at("2026-06-11T01:00:00Z") }); // 21:00 EDT on the 10th
  assert.equal(decision.allowed, false);
  assert.equal(decision.localHour, 21);
});

test("the same instant is legal in one state and illegal in another", () => {
  // 08:30 Eastern is 05:30 Pacific: fine in New York, a violation in California.
  const instant = at("2026-06-10T12:30:00Z");
  assert.equal(canDialNow({ state: "NY", at: instant, timezones: tz }).allowed, true);
  const ca = canDialNow({ state: "CA", at: instant, timezones: tz });
  assert.equal(ca.allowed, false);
  assert.equal(ca.localHour, 5);
});

// ── state statutes beat the federal default ──────────────────────────────────

const tighterNY = { NY: { state: "NY", window: { startHour: 9, endHour: 20 } } };

test("a tighter state statute is enforced over the federal default", () => {
  // 08:30 EDT: legal federally, illegal under a 9-8 state rule.
  const decision = dial({ at: at("2026-06-10T12:30:00Z"), stateRules: tighterNY });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "outside_window");
  assert.deepEqual(decision.window, { startHour: 9, endHour: 20 });
});

test("a state rule that tries to be LOOSER than federal is ignored", () => {
  const loose = { NY: { state: "NY", window: { startHour: 6, endHour: 23 } } };
  const decision = dial({ at: at("2026-06-10T11:00:00Z"), stateRules: loose }); // 07:00 EDT
  assert.equal(decision.allowed, false, "a state cannot widen past the federal floor");
  assert.deepEqual(decision.window, FEDERAL_WINDOW);
});

// ── Sunday and holidays ──────────────────────────────────────────────────────

test("a state that forbids Sunday calls refuses one inside the hours", () => {
  const rules = { NY: { state: "NY", noSunday: true } };
  // 2026-06-14 is a Sunday. 15:00Z is 11:00 EDT, comfortably inside the window.
  const decision = dial({ at: at("2026-06-14T15:00:00Z"), stateRules: rules });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "sunday");
  assert.equal(decision.localWeekday, 0);
});

test("the same Sunday is fine in a state without the rule", () => {
  assert.equal(dial({ at: at("2026-06-14T15:00:00Z") }).allowed, true);
});

test("a state holiday is refused, and a federal one applies everywhere", () => {
  const rules = { NY: { state: "NY", noHolidays: true } };
  const stateOnly = dial({ at: at("2026-07-04T15:00:00Z"), stateRules: rules, holidays: new Set(["NY:2026-07-04"]) });
  assert.equal(stateOnly.reason, "holiday");

  const federal = dial({ at: at("2026-07-04T15:00:00Z"), stateRules: rules, holidays: new Set(["*:2026-07-04"]) });
  assert.equal(federal.reason, "holiday");

  // Another state's holiday is not ours.
  const other = dial({ at: at("2026-07-04T15:00:00Z"), stateRules: rules, holidays: new Set(["TX:2026-07-04"]) });
  assert.equal(other.allowed, true);
});

// ── DST and Phoenix, which the criterion names explicitly ────────────────────

test("America/Phoenix does not observe DST, so the same UTC hour moves relative to New York", () => {
  // 14:00Z. In January Phoenix is UTC-7 (07:00) and New York UTC-5 (09:00).
  const january = at("2026-01-15T14:00:00Z");
  assert.equal(localPartsIn(january, "America/Phoenix").hour, 7);
  assert.equal(localPartsIn(january, "America/New_York").hour, 9);

  // In July Phoenix is STILL UTC-7 (07:00) while New York has moved to UTC-4 (10:00).
  const july = at("2026-07-15T14:00:00Z");
  assert.equal(localPartsIn(july, "America/Phoenix").hour, 7);
  assert.equal(localPartsIn(july, "America/New_York").hour, 10);
});

test("07:00 in Phoenix is refused in both January and July — the rule does not drift with DST", () => {
  for (const instant of ["2026-01-15T14:00:00Z", "2026-07-15T14:00:00Z"]) {
    const decision = canDialNow({ state: "AZ", at: at(instant), timezones: tz });
    assert.equal(decision.allowed, false, instant);
    assert.equal(decision.localHour, 7, instant);
  }
});

test("across the spring-forward boundary the answer follows the wall clock, not the offset", () => {
  // US DST began 2026-03-08. At 12:30Z: on the 7th New York is UTC-5 (07:30, refused);
  // on the 8th it is UTC-4 (08:30, allowed). Same UTC time, different answer — which is the
  // whole reason this is computed in the zone rather than from a stored offset.
  assert.equal(canDialNow({ state: "NY", at: at("2026-03-07T12:30:00Z"), timezones: tz }).localHour, 7);
  assert.equal(canDialNow({ state: "NY", at: at("2026-03-07T12:30:00Z"), timezones: tz }).allowed, false);
  assert.equal(canDialNow({ state: "NY", at: at("2026-03-08T12:30:00Z"), timezones: tz }).localHour, 8);
  assert.equal(canDialNow({ state: "NY", at: at("2026-03-08T12:30:00Z"), timezones: tz }).allowed, true);
});

// ── tenant and campaign tightening ───────────────────────────────────────────

test("a tenant can narrow the window", () => {
  const decision = dial({ at: at("2026-06-10T13:30:00Z"), tenantWindow: { startHour: 10, endHour: 18 } }); // 09:30 EDT
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.window, { startHour: 10, endHour: 18 });
});

test("a tenant CANNOT widen the window", () => {
  const decision = dial({ at: at("2026-06-10T11:00:00Z"), tenantWindow: { startHour: 5, endHour: 23 } }); // 07:00 EDT
  assert.equal(decision.allowed, false, "a tenant setting must not buy back the federal hour");
  assert.deepEqual(decision.window, FEDERAL_WINDOW);
});

test("a campaign narrows on top of the tenant, and cannot widen past it either", () => {
  const narrowed = dial({
    at: at("2026-06-10T15:00:00Z"), // 11:00 EDT
    tenantWindow: { startHour: 9, endHour: 20 },
    campaignWindow: { startHour: 12, endHour: 17 },
  });
  assert.equal(narrowed.allowed, false);
  assert.deepEqual(narrowed.window, { startHour: 12, endHour: 17 });

  const widened = dial({
    at: at("2026-06-10T15:00:00Z"),
    tenantWindow: { startHour: 12, endHour: 17 },
    campaignWindow: { startHour: 6, endHour: 23 },
  });
  assert.deepEqual(widened.window, { startHour: 12, endHour: 17 });
});

test("every layer at once composes to the most restrictive of them", () => {
  const decision = dial({
    at: at("2026-06-10T15:00:00Z"),
    stateRules: { NY: { state: "NY", window: { startHour: 9, endHour: 20 } } },
    tenantWindow: { startHour: 10, endHour: 19 },
    campaignWindow: { startHour: 11, endHour: 16 },
  });
  assert.deepEqual(decision.window, { startHour: 11, endHour: 16 });
  assert.equal(decision.allowed, true); // 11:00 is the first legal hour
});

test("contradictory tightenings close the window rather than inverting it", () => {
  const decision = dial({
    tenantWindow: { startHour: 18, endHour: 20 },
    campaignWindow: { startHour: 9, endHour: 11 },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "window_closed");
});

// ── every refusal explains itself ────────────────────────────────────────────

test("no refusal is ever returned without a message the dialer can show", () => {
  const refusals = [
    dial({ state: null }),
    dial({ state: "ZZ" }),
    dial({ at: at("2026-06-10T11:00:00Z") }),
    dial({ at: at("2026-06-14T15:00:00Z"), stateRules: { NY: { state: "NY", noSunday: true } } }),
    dial({ at: at("2026-07-04T15:00:00Z"), stateRules: { NY: { state: "NY", noHolidays: true } }, holidays: new Set(["*:2026-07-04"]) }),
    dial({ tenantWindow: { startHour: 18, endHour: 20 }, campaignWindow: { startHour: 9, endHour: 11 } }),
  ];
  for (const decision of refusals) {
    assert.equal(decision.allowed, false, decision.reason);
    assert.ok(decision.message && decision.message.length > 10, `${decision.reason} had no message`);
  }
});

test("an allowed decision carries no message, so the UI has nothing to show", () => {
  const decision = dial();
  assert.equal(decision.allowed, true);
  assert.equal(decision.message, null);
});
