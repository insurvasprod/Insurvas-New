/**
 * LA-2.11 and LA-2.12, pinned.
 *
 * Two more finished mechanisms with no callers, found the same way as `serve_next_lead`:
 *
 *   `book_appointment`        0 callers — a setter could not book an appointment at all, which is
 *                             the one thing LA-2.12 is named for.
 *   `reschedule_appointment`  0 callers
 *   `close_out_due_appointments` 0 callers — so decision 12's automatic show-marking and its
 *                             pending state never happened, leaving the close-out strip
 *                             permanently empty and the show rate computed over hand-marked
 *                             appointments only.
 *
 * `book_appointment` already enforces every LA-2.11 acceptance criterion. These tests assert that
 * it is reachable, that nothing re-implements its rules in TypeScript, and that the rules it owns
 * stay where they are.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(MIGRATIONS).sort();

function latestDefining(pattern) {
  for (let index = files.length - 1; index >= 0; index--) {
    const body = readFileSync(join(MIGRATIONS, files[index]), "utf8");
    if (pattern.test(body)) return { name: files[index], body };
  }
  return null;
}

test("booking and rescheduling are reachable from the product", () => {
  const service = read("lib", "appointments", "booking.ts");
  assert.match(service, /rpc\("book_appointment"/, "nothing calls book_appointment");
  assert.match(service, /rpc\("reschedule_appointment"/, "nothing calls reschedule_appointment");

  const route = read("app", "api", "app", "appointments", "route.ts");
  assert.match(route, /bookAppointment/);
  assert.match(route, /rescheduleAppointment/);
  assert.match(route, /export async function POST\(/);
  assert.match(route, /export async function PATCH\(/);
});

test("a setter may book, and the route says so on purpose", () => {
  const route = read("app", "api", "app", "appointments", "route.ts");
  // LA-2.12's role table: a setter CAN "book appointments into Ray's slots" and CANNOT "change
  // availability or configuration". This is the one route where the setter is the primary user.
  assert.match(route, /const BOOKING_ROLES = \["owner", "producer", "setter"\]/);

  const policy = read("lib", "entitlements", "agentApiPolicy.ts");
  assert.match(
    policy,
    /appointments\/route\.ts", featureKey: "outbound_dialing", allowedRoles: \["owner", "producer", "setter"\]/,
  );
});

test("the booker is the signed-in user, never a value from the request body", () => {
  const route = read("app", "api", "app", "appointments", "route.ts");
  // LA-2.12 measures setters on booked-versus-showed. A client that could name its own `booked_by`
  // could attribute its bookings to somebody else, which is the measurement marking itself.
  assert.match(route, /bookedBy: auth\.context\.userId/);
  const schema = route.slice(route.indexOf("const bookSchema"), route.indexOf("const rescheduleSchema"));
  assert.doesNotMatch(schema, /booked_by/);
});

test("no booking rule is re-implemented in TypeScript", () => {
  const service = read("lib", "appointments", "booking.ts");
  const route = read("app", "api", "app", "appointments", "route.ts");
  // The overlap in particular cannot be decided outside the database without reintroducing the
  // race. LA-2.11: "resolved by the database with a constraint — not by a client-side check on a
  // stale slot list."
  for (const source of [service, route]) {
    assert.doesNotMatch(source, /tenant_can_dial_now/, "the window check belongs to the RPC");
    assert.doesNotMatch(source, /max_per_day >=|dailyCap/, "the cap belongs to the RPC");
  }
  const workspace = read("components", "app", "dialer-workspace.tsx");
  assert.doesNotMatch(workspace, /tenant_can_dial_now/);
});

test("every refusal the database can raise has a sentence a setter can act on", () => {
  const service = read("lib", "appointments", "booking.ts");
  const book = latestDefining(/create or replace function public\.book_appointment/);

  // Each raised code is a different thing to do about it, so collapsing them into "could not book"
  // would leave somebody guessing which rule they hit.
  for (const code of [
    "APPOINTMENT_IN_THE_PAST",
    "APPOINTMENT_LEAD_HAS_NO_STATE",
    "APPOINTMENT_OUTSIDE_CUSTOMER_WINDOW",
    "APPOINTMENT_OUTSIDE_AVAILABILITY",
    "APPOINTMENT_BLOCKED_TIME",
    "APPOINTMENT_DAILY_CAP_REACHED",
    "APPOINTMENT_SLOT_TAKEN",
  ]) {
    assert.match(service, new RegExp(code), `${code} has no message`);
    if (book) assert.match(book.body, new RegExp(code), `${code} is not raised by book_appointment`);
  }

  // The race reads as "the slot went", which is LA-2.11 criterion 1's own wording — "one succeeds,
  // one is told it went" — rather than as a failure.
  assert.match(service, /taken while you were booking it/);

  // An unrecognised failure is a 503, not a 400: an unknown error is ours, and telling a setter to
  // fix their input would be wrong.
  const route = read("app", "api", "app", "appointments", "route.ts");
  assert.match(route, /status: 503/);
});

test("the close-out pass has a caller, on a schedule and from the command line", () => {
  const closeOutSource = read("lib", "appointments", "closeOut.ts");
  assert.match(closeOutSource, /rpc\("close_out_due_appointments"/, "nothing calls the close-out pass");

  const route = read("app", "api", "internal", "appointment-close-out", "route.ts");
  assert.match(route, /processAppointmentCloseOut/);
  // Same secret and shape as the other internal jobs, so a deployment schedules one pattern.
  assert.match(route, /process\.env\.CRON_SECRET/);

  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts["appointments:close-out"], "there is no way to run the pass by hand");
});

test("a partial close-out failure is reported rather than hidden behind an error status", () => {
  const closeOutSource = read("lib", "appointments", "closeOut.ts");
  // One tenant's bad data must not stop every other tenant's appointments closing out, and a job
  // that stops half way through is worse than one that reports what it could not do.
  assert.match(closeOutSource, /summary\.failures\.push/);
  assert.match(closeOutSource, /continue;/);

  const route = read("app", "api", "internal", "appointment-close-out", "route.ts");
  const handler = route.slice(route.indexOf("const summary"), route.indexOf("} catch"));
  assert.doesNotMatch(handler, /status: 503/, "a partial failure must still return the summary");
});

test("pending is a parking state, never a no-show", () => {
  const closeOut = latestDefining(/create or replace function public\.close_out_due_appointments/);
  if (closeOut) {
    // Decision 12: "a missing mark never silently becomes a penalty against someone's pay."
    assert.match(closeOut.body, /status = 'pending'/);
    assert.doesNotMatch(closeOut.body, /set status = 'no_show'/);
  }
  // The strip is where a human answers, and only these four outcomes are answerable.
  const route = read("app", "api", "app", "appointments", "close-out", "route.ts");
  assert.match(route, /z\.enum\(\["showed", "no_show", "cancelled", "rescheduled"\]\)/);
  // And recording an outcome is owner/producer only — a setter marking their own appointments as
  // shown is the measurement marking itself.
  assert.match(route, /const OUTCOME_ROLES = \["owner", "producer"\]/);
});

test("the setter's notes reach the agent, and the agent is notified", () => {
  const book = latestDefining(/create or replace function public\.book_appointment/);
  assert.ok(book, "book_appointment is not defined in any migration");
  assert.match(book.body, /notes/);

  // The notification is NOT in the migration that defines book_appointment. LA-2.12's own
  // migration patches it into the live body afterwards, the same string-replacement pattern that
  // installs the callback window check — so the assertion has to follow the notification wherever
  // it was added rather than assume the defining migration carries it.
  const notify = latestDefining(/appointment_booked/);
  assert.ok(notify, "nothing notifies the agent that an appointment was booked");
  assert.match(notify.body, /agent_notifications/);
  // Only when somebody else booked it. Ray does not need telling about his own booking, and a
  // self-notification would train him to ignore the channel.
  assert.match(notify.body, /p_agent_user_id <> coalesce\(p_booked_by, p_agent_user_id\)/);
  // Idempotent, so a retried booking does not produce two notifications.
  assert.match(notify.body, /on conflict \(tenant_id, recipient_user_id, source_key\) do nothing/);

  const workspace = read("components", "app", "dialer-workspace.tsx");
  // The notes field exists where the setter is, which is the dialer — not on a calendar screen
  // they would have to navigate to after hanging up.
  assert.match(workspace, /Notes for the agent/);
});

test("double-booking is prevented by a constraint, not by a check", () => {
  const book = latestDefining(/create or replace function public\.book_appointment/);
  // The function deliberately does NOT check for an overlap: it inserts and catches
  // exclusion_violation. That is the only arrangement in which two setters racing on one slot get
  // one winner instead of two rows.
  assert.match(book.body, /exception when exclusion_violation then/);
  assert.match(book.body, /APPOINTMENT_SLOT_TAKEN/);
});
