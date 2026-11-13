import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appointmentIdOf,
  lengthChange,
  busyFromEvents,
  canWriteEvents,
  endOf,
  eventBody,
  eventIdFor,
  GOOGLE_EVENTS_SCOPE,
  GOOGLE_FREEBUSY_SCOPE,
  isOurEvent,
  leadName,
  mirrorAction,
  zonedMidnightUtc,
} from "./calendarMirrorCore.ts";

const APPOINTMENT = "3f2b9c1e-7a4d-4e8b-9c0a-12ab34cd56ef";

test("the event id is the appointment, in Google's base32hex alphabet", () => {
  const id = eventIdFor(APPOINTMENT);
  assert.equal(id, "insurvas3f2b9c1e7a4d4e8b9c0a12ab34cd56ef");
  assert.match(id, /^[0-9a-v]{5,1024}$/);
  assert.equal(eventIdFor(APPOINTMENT.toUpperCase()), id);
  assert.throws(() => eventIdFor("not-a-uuid"));
  assert.ok(isOurEvent(id));
  assert.ok(!isOurEvent("abc123"));
  assert.ok(!isOurEvent(undefined));
});

test("only a link that granted events (or the whole calendar) writes", () => {
  assert.ok(canWriteEvents(["openid", GOOGLE_FREEBUSY_SCOPE, GOOGLE_EVENTS_SCOPE]));
  assert.ok(canWriteEvents(["https://www.googleapis.com/auth/calendar"]));
  assert.ok(!canWriteEvents(["openid", "email", GOOGLE_FREEBUSY_SCOPE]));
  assert.ok(!canWriteEvents(null));
});

test("booked and confirmed are written, cancelled and moved are removed, the rest is left", () => {
  assert.equal(mirrorAction("booked"), "upsert");
  assert.equal(mirrorAction("confirmed"), "upsert");
  assert.equal(mirrorAction("cancelled"), "remove");
  assert.equal(mirrorAction("rescheduled"), "remove");
  for (const status of ["pending", "showed", "no_show", "something_new"]) assert.equal(mirrorAction(status), "keep");
});

test("the event carries the name, the times and a link back, never more of the lead", () => {
  const body = eventBody(
    { appointmentId: APPOINTMENT, leadId: "lead-1", customerName: "Dana Reyes", startsAtUtc: "2026-11-20T15:00:00Z", endsAtUtc: null, durationMinutes: 45, notes: " Wants a quote for 250k " },
    "https://app.insurvas.com/",
  );
  assert.equal(body.id, eventIdFor(APPOINTMENT));
  assert.equal(body.summary, "Call with Dana Reyes");
  assert.deepEqual(body.start, { dateTime: "2026-11-20T15:00:00.000Z", timeZone: "UTC" });
  assert.deepEqual(body.end, { dateTime: "2026-11-20T15:45:00.000Z", timeZone: "UTC" });
  assert.match(String(body.description), /https:\/\/app\.insurvas\.com\/app\/leads\/lead-1/);
  assert.match(String(body.description), /Notes: Wants a quote for 250k$/);
  assert.equal(body.status, "confirmed");
});

test("the end is the stored end, else start plus duration, else half an hour", () => {
  assert.equal(endOf({ startsAtUtc: "2026-11-20T15:00:00Z", endsAtUtc: "2026-11-20T15:20:00Z", durationMinutes: 45 }), "2026-11-20T15:20:00.000Z");
  assert.equal(endOf({ startsAtUtc: "2026-11-20T15:00:00Z", endsAtUtc: null, durationMinutes: 0 }), "2026-11-20T15:30:00.000Z");
});

test("the lead's name comes from its values", () => {
  assert.equal(leadName({ full_name: "Dana Reyes" }), "Dana Reyes");
  assert.equal(leadName({ first_name: "Dana", last_name: "Reyes" }), "Dana Reyes");
  assert.equal(leadName(null), "a lead");
});

test("busy time leaves out our own meetings, free, cancelled and declined events", () => {
  const busy = busyFromEvents(
    [
      { id: "abc", start: { dateTime: "2026-11-20T14:00:00-05:00" }, end: { dateTime: "2026-11-20T15:00:00-05:00" } },
      { id: eventIdFor(APPOINTMENT), start: { dateTime: "2026-11-20T16:00:00Z" }, end: { dateTime: "2026-11-20T16:30:00Z" } },
      { id: "free", transparency: "transparent", start: { dateTime: "2026-11-20T17:00:00Z" }, end: { dateTime: "2026-11-20T18:00:00Z" } },
      { id: "gone", status: "cancelled", start: { dateTime: "2026-11-20T17:00:00Z" }, end: { dateTime: "2026-11-20T18:00:00Z" } },
      { id: "no", attendees: [{ self: true, responseStatus: "declined" }], start: { dateTime: "2026-11-20T19:00:00Z" }, end: { dateTime: "2026-11-20T20:00:00Z" } },
      { id: "allday", start: { date: "2026-11-21" }, end: { date: "2026-11-22" } },
    ],
    "America/New_York",
  );
  assert.deepEqual(busy, [
    { startsAt: "2026-11-20T19:00:00.000Z", endsAt: "2026-11-20T20:00:00.000Z" },
    { startsAt: "2026-11-21T05:00:00.000Z", endsAt: "2026-11-22T05:00:00.000Z" },
  ]);
});

test("an event of ours names its appointment again", () => {
  assert.equal(appointmentIdOf(eventIdFor(APPOINTMENT)), APPOINTMENT);
  assert.equal(appointmentIdOf("abc"), null);
  assert.equal(appointmentIdOf("insurvasxyz"), null);
});

test("a meeting made longer in Google takes the new length; a move or no change does not", () => {
  const appointment = { startsAtUtc: "2026-11-13T17:00:00+00:00", durationMinutes: 30 };
  const event = (start, end, extra = {}) => ({ start: { dateTime: start }, end: { dateTime: end }, ...extra });
  assert.equal(lengthChange(event("2026-11-13T12:00:00-05:00", "2026-11-13T13:00:00-05:00"), appointment), 60);
  assert.equal(lengthChange(event("2026-11-13T12:00:00-05:00", "2026-11-13T12:30:00-05:00"), appointment), null);
  assert.equal(lengthChange(event("2026-11-13T13:00:00-05:00", "2026-11-13T14:00:00-05:00"), appointment), null);
  assert.equal(lengthChange(event("2026-11-13T12:00:00-05:00", "2026-11-13T22:00:00-05:00"), appointment), null);
  assert.equal(lengthChange(event("2026-11-13T12:00:00-05:00", "2026-11-13T13:00:00-05:00", { status: "cancelled" }), appointment), null);
});

test("midnight in a zone, either side of a daylight-saving change", () => {
  assert.equal(zonedMidnightUtc("2026-07-01", "America/New_York"), "2026-07-01T04:00:00.000Z");
  assert.equal(zonedMidnightUtc("2026-11-02", "America/New_York"), "2026-11-02T05:00:00.000Z");
  assert.equal(zonedMidnightUtc("2026-11-02", "UTC"), "2026-11-02T00:00:00.000Z");
});
