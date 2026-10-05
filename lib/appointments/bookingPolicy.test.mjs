// Run with: npm test
//
// Settings › Calendar & availability (20260924230200). "Allow double-booking" was locked off,
// "Honour linked calendars" was read by nothing, "Maximum per day" was per agent while the board
// says agency-wide, and the dialer's booking picker ignored repeating blocks and the same-day switch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { openSlots, zonedInstant } from "./calendarMath.ts";
import { dialerSource } from "../dialerScripts/dialerSource.mjs";

const root = process.cwd();
const MIGRATIONS = join(root, "supabase", "migrations");
const files = readdirSync(MIGRATIONS).sort();
function latestDefining(pattern) {
  for (let index = files.length - 1; index >= 0; index--) {
    const body = readFileSync(join(MIGRATIONS, files[index]), "utf8");
    if (pattern.test(body)) return { name: files[index], body };
  }
  return null;
}
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");

const AGENT = "agent-1";
// Monday 28 September 2026, 08:00 UTC. The agent works 09:00–12:00 UTC on Mondays.
const NOW = Date.UTC(2026, 8, 28, 8, 0);
const base = (overrides = {}) => ({
  availability: [{ userId: AGENT, weekday: 1, startTime: "09:00", endTime: "12:00", timezone: "UTC" }],
  blocks: [],
  policy: [{ userId: AGENT, appointmentMinutes: 30, bufferMinutes: 0, maxPerDay: null, allowSameDay: true, allowDoubleBooking: false }],
  upcoming: [],
  busy: [],
  ...overrides,
});
const at = (hour, minute = 0, day = 28) => new Date(Date.UTC(2026, 8, day, hour, minute)).toISOString();

test("the picker proposes the agent's working slots, soonest first", () => {
  const slots = openSlots(base(), AGENT, NOW, { days: 0 });
  assert.deepEqual(slots, [at(9), at(9, 30), at(10), at(10, 30), at(11), at(11, 30)]);
});

test("a repeating block removes its time on every day it recurs, not only its first date", () => {
  // Stored as 21 September, 10:00–10:30 — a date that has already ended — repeating daily.
  const blocks = [{ userId: AGENT, startsAt: at(10, 0, 21), endsAt: at(10, 30, 21), repeats: "daily" }];
  const slots = openSlots(base({ blocks }), AGENT, NOW, { days: 0 });
  assert.ok(!slots.includes(at(10)), "the repeating block's occurrence today was offered");
  assert.ok(slots.includes(at(9, 30)) && slots.includes(at(10, 30)));
});

test("same-day booking off skips today", () => {
  const policy = [{ ...base().policy[0], allowSameDay: false }];
  const slots = openSlots(base({ policy }), AGENT, NOW, { days: 7 });
  assert.ok(slots.every((slot) => !slot.startsWith("2026-09-28")), "a same-day slot was offered with same-day off");
  assert.ok(slots[0].startsWith("2026-10-05T09:00"), `expected next Monday, got ${slots[0]}`);
});

test("a taken slot is offered again only when double-booking is on", () => {
  const upcoming = [{ agentUserId: AGENT, startsAtUtc: at(9, 30), durationMinutes: 30, status: "booked" }];
  assert.ok(!openSlots(base({ upcoming }), AGENT, NOW, { days: 0 }).includes(at(9, 30)));
  const policy = [{ ...base().policy[0], allowDoubleBooking: true }];
  assert.ok(openSlots(base({ upcoming, policy }), AGENT, NOW, { days: 0 }).includes(at(9, 30)));
});

test("linked-calendar busy time and the per-agent limit remove slots", () => {
  const busy = [{ userId: AGENT, startsAt: at(11), endsAt: at(11, 30) }];
  assert.ok(!openSlots(base({ busy }), AGENT, NOW, { days: 0 }).includes(at(11)));
  const policy = [{ ...base().policy[0], maxPerDay: 2 }];
  assert.equal(openSlots(base({ policy }), AGENT, NOW, { days: 0 }).length, 2);
});

test("wall-clock times convert across a DST change", () => {
  assert.equal(zonedInstant(2026, 10, 30, 540, "America/New_York"), Date.UTC(2026, 9, 30, 13, 0));
  assert.equal(zonedInstant(2026, 11, 2, 540, "America/New_York"), Date.UTC(2026, 10, 2, 14, 0));
});

// The seat constraint and the calendar tables live in 20260924230200; book_appointment itself has
// been restated since (20260925704000 added APPOINTMENT_AGENT_HAS_NO_HOURS), so the function is
// read from its LATEST definition and the schema from the migration that created it.
function seats() {
  const name = files.find((file) => file.startsWith("20260924230200_"));
  return { name, body: readFileSync(join(MIGRATIONS, name), "utf8") };
}

test("double-booking is two seats under the same exclusion constraint, never a count", () => {
  const schema = seats();
  assert.match(schema.body, /seat with =,\s*\n\s*tstzrange\(starts_at_utc, occupied_until_utc, '\[\)'\) with &&/);
  assert.match(schema.body, /check \(seat in \(1, 2\)\)/);
  const migration = latestDefining(/create or replace function public\.book_appointment/);
  assert.ok(migration);
  assert.match(migration.body, /if not coalesce\(v_policy\.allow_double_booking, false\) then\s*\n\s*raise exception 'APPOINTMENT_SLOT_TAKEN'/);
});

test("an agent with no working hours is refused, and every refusal has a sentence", () => {
  const migration = latestDefining(/create or replace function public\.book_appointment/);
  assert.match(migration.body, /APPOINTMENT_AGENT_HAS_NO_HOURS/);
  const booking = read("lib", "appointments", "booking.ts");
  for (const code of ["APPOINTMENT_AGENT_HAS_NO_HOURS", "APPOINTMENT_NOT_FOUND", "APPOINTMENT_NOT_ACTIVE", "APPOINTMENT_NOT_A_NO_SHOW", "APPOINTMENT_ALREADY_REBOOKED"])
    assert.match(booking, new RegExp(`${code}: \\[`), `${code} has no message`);
});

test("the agency cap, linked busy time and a stale feed are refused by book_appointment itself", () => {
  const migration = latestDefining(/create or replace function public\.book_appointment/);
  assert.match(migration.body, /APPOINTMENT_AGENCY_DAILY_CAP_REACHED/);
  assert.match(migration.body, /pg_advisory_xact_lock\(hashtextextended\('booking-cap:'/);
  assert.match(migration.body, /cc\.status = 'connected'/);
  assert.match(migration.body, /APPOINTMENT_LINKED_CALENDAR_BUSY/);
  assert.match(migration.body, /APPOINTMENT_CALLING_RULES_STALE/);
  // The per-agent cap is kept beside the agency one.
  assert.match(migration.body, /APPOINTMENT_DAILY_CAP_REACHED/);
  // Tokens are server-only.
  assert.match(seats().body, /revoke all on public\.tenant_connected_calendars, public\.tenant_calendar_busy from anon, authenticated, public, tenant_app/);

  const booking = read("lib", "appointments", "booking.ts");
  for (const code of ["APPOINTMENT_AGENCY_DAILY_CAP_REACHED", "APPOINTMENT_LINKED_CALENDAR_BUSY", "APPOINTMENT_CALLING_RULES_STALE"])
    assert.match(booking, new RegExp(code), `${code} has no message`);
});

test("the picker's context carries repeating blocks, the same-day switch and busy time", () => {
  const booking = read("lib", "appointments", "booking.ts");
  assert.match(booking, /repeats\.neq\.none/, "repeating blocks whose first date has passed are dropped again");
  assert.match(booking, /allow_same_day/);
  assert.match(booking, /allow_double_booking/);
  assert.match(booking, /tenant_calendar_busy/);
  const workspace = dialerSource();
  assert.match(workspace, /openSlots\(context, bookAgent/);
});

test("a calendar save that needs a newer schema is refused before anything is written", () => {
  const availability = read("lib", "appointments", "availability.ts");
  const save = availability.slice(availability.indexOf("export async function saveCalendarSettings"));
  assert.ok(save.indexOf("await assertSchemaFits(db, input)") < save.indexOf('from("tenant_agent_availability")'));
});

test("the linked-calendar toggle is tied to a real connection", () => {
  const screen = read("components", "app", "calendar-availability-settings.tsx");
  assert.match(screen, /disabled=\{busy \|\| !ready \|\| connected\.length === 0\}/);
  assert.doesNotMatch(screen, /today this is stored and has no effect/);
  const seam = read("lib", "appointments", "linkedCalendars.ts");
  assert.match(seam, /export interface BusyTimeSource/);
  assert.match(seam, /if \(text\(row\.tenant_id\) !== input\.tenantId\) throw new CalendarWrongWorkspaceError\(\)/);
});
