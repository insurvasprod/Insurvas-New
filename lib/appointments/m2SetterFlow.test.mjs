// Module 2 push, FIX builder A (2026-09-29): the appointment walk, the setter's view of the diary,
// the scorecard's reschedule rule, the roster and the reminders that need no app host.
// The rules live in SQL (20260929202000) and in the routes; held here structurally, plus the pure
// helpers by behaviour.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { customerReminderAllowed } from "./reminderContract.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS = join(root, "supabase", "migrations");
const files = readdirSync(MIGRATIONS).sort();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
function latestDefining(pattern) {
  for (let index = files.length - 1; index >= 0; index -= 1) {
    const body = readFileSync(join(MIGRATIONS, files[index]), "utf8");
    if (pattern.test(body)) return { name: files[index], body };
  }
  return null;
}
function fnBody(pattern, name) {
  const migration = latestDefining(pattern);
  assert.ok(migration, `${name} is not defined`);
  const start = migration.body.search(pattern);
  const end = migration.body.indexOf("$function$;", start);
  return migration.body.slice(start, end);
}

test("LA-2.11-5 · the walk has a confirmed step, and nobody shows before the call", () => {
  const fn = fnBody(/create or replace function public\.mark_appointment_outcome/, "mark_appointment_outcome");
  assert.match(fn, /p_outcome not in \('confirmed', 'showed', 'no_show', 'cancelled'\)/);
  assert.match(fn, /if a\.status <> 'booked' then/, "confirmed is reached from booked only");
  assert.match(fn, /p_outcome in \('showed', 'no_show'\) and a\.starts_at_utc > now\(\)[\s\S]{0,80}APPOINTMENT_NOT_YET_HELD/);
  // The setter being measured still never writes showed or no-show.
  assert.match(fn, /else\s+[\s\S]{0,200}if v_role = 'setter' then\s+raise exception 'SETTER_MAY_NOT_RECORD_OUTCOMES'/);
  // A setter confirms only a booking of their own.
  assert.match(fn, /v_role = 'setter' and a\.booked_by is distinct from p_actor/);

  const route = read("app", "api", "app", "appointments", "route.ts");
  assert.match(route, /action: z\.literal\("confirm"\)/);
  assert.match(route, /confirmAppointment\(\{ tenantId: auth\.context\.tenantId, appointmentId: confirm\.data\.appointment_id, actorId: auth\.context\.userId \}\)/);
  // Before the migration the step is unknown to the database: a 503 saying so, never a 400.
  const booking = read("lib", "appointments", "booking.ts");
  assert.match(booking, /APPOINTMENT_OUTCOME_UNKNOWN\/\.test\(result\.error\.message\)\) throw new SchemaGapError\(\)/);
});

test("LA-2.12-4 · a reschedule is one booking, the first booker's", () => {
  const fn = fnBody(/create or replace function public\.reschedule_appointment/, "reschedule_appointment");
  assert.match(fn, /booked_by = coalesce\(a\.booked_by, booked_by\)/);
  assert.match(fn, /rescheduled_from = a\.id/);
  assert.match(fn, /first_booked_at = coalesce\(a\.first_booked_at, a\.created_at\)/);
  assert.match(fn, /rebooked_from = coalesce\(a\.rebooked_from, rebooked_from\)/, "a rebooking keeps its link when moved");
  // Still the atomic move LA-2.11 criterion 5 asks for.
  assert.ok(fn.indexOf("set status = 'rescheduled'") < fn.indexOf("from book_appointment("));

  const migration = latestDefining(/create or replace view public\.tenant_setter_scorecard/);
  assert.ok(migration);
  const view = migration.body.slice(migration.body.indexOf("create or replace view public.tenant_setter_scorecard"));
  assert.match(view, /and ap\.status <> 'rescheduled'/);
  assert.match(view, /date_trunc\('day', coalesce\(ap\.first_booked_at, ap\.created_at\)\)/);
  const agent = fnBody(/create or replace function public\.setter_scorecard_for_agent/, "setter_scorecard_for_agent");
  assert.match(agent, /and ap\.status <> 'rescheduled'/);
  assert.match(agent, /coalesce\(ap\.first_booked_at, ap\.created_at\) >= p_since/);
});

test("LA-2.12-4 · the activity report counts a reschedule once too (20260929202100)", () => {
  const patch = read("supabase", "migrations", "20260929202100_m2_activity_report_booked_excludes_reschedules.sql");
  assert.match(patch, /replace\(pg_get_functiondef\([^;]*\), E'\\r\\n', E'\\n'\)/, "the live body is CRLF and must be normalised");
  assert.match(patch, /ap\.booked_by = p\.agent_user_id and ap\.status <> ''rescheduled'' \/\* \[202100\] \*\//);
  assert.match(patch, /the appointments_booked anchor is not there exactly once/);
  assert.match(patch, /has_schema_privilege\(current_user, 'public', 'CREATE'\)/);
});

test("the roster says 'No hours set' rather than 'Off shift' for a member with no hours", () => {
  const view = read("components", "app", "activity-log-workspace.tsx");
  assert.match(view, /member\.hasHours === false \? "No hours set" : member\.onShiftNow \? "On shift" : "Off shift"/);
});

test("a booking that times out says nothing was booked and to try again", () => {
  const route = read("app", "api", "app", "appointments", "route.ts");
  assert.match(route, /if \(!known && \/statement timeout\/i\.test\(message\)\)/);
  assert.match(route, /code: "booking_timeout"/);
  assert.match(route, /console\.error\("\[appointments\] unmapped booking failure"/);
});

test("LA-2.12-2 · a setter sees taken slots, not other setters' leads, and changes only their own", () => {
  const calendar = read("lib", "appointments", "calendar.ts");
  assert.match(calendar, /export function redactCalendarForSetter/);
  for (const field of ['leadId: ""', "customerName: REDACTED_CUSTOMER", "notes: null", "bookedByName: null", "product: null", "faceAmountCents: null"])
    assert.ok(calendar.includes(field), `the setter's calendar still carries ${field.split(":")[0]}`);
  const calendarRoute = read("app", "api", "app", "calendar", "route.ts");
  assert.match(calendarRoute, /auth\.context\.role === "setter" \? redactCalendarForSetter\(appointments, auth\.context\.userId\) : appointments/);

  const route = read("app", "api", "app", "appointments", "route.ts");
  // Reschedule, rebook and confirm all ask first.
  assert.equal((route.match(/await notTheSettersOwn\(/g) ?? []).length, 3);
  for (const name of ["reschedule_appointment", "rebook_appointment"]) {
    const fn = fnBody(new RegExp(`create or replace function public\\.${name}`), name);
    assert.match(fn, /if v_role = 'setter' and a\.booked_by is distinct from p_actor then\s+raise exception 'APPOINTMENT_NOT_YOURS'/);
  }
  assert.match(read("lib", "appointments", "booking.ts"), /APPOINTMENT_NOT_YOURS: \[403,/);

  const assignments = read("app", "api", "app", "assignments", "route.ts");
  assert.match(assignments, /auth\.context\.role === "setter" \? \{ \.\.\.workspace, rules: \[\], insights: null \} : workspace/);
});

test("a setter is never offered as somebody to book with", () => {
  const booking = read("lib", "appointments", "booking.ts");
  assert.match(booking, /from\("tenant_users"\)\.select\("user_id, role, accepted_at"\)\.eq\("tenant_id", tenantId\)\.in\("role", \["owner", "producer"\]\)/);
  assert.match(booking, /filter\(\(row\) => bookable\.has\(text\(row\.user_id\)\)\)/);
});

test("LA-2.12-6 · the roster lists every setter, with or without working hours", () => {
  const migration = latestDefining(/create or replace view public\.tenant_member_roster/);
  assert.ok(migration);
  const view = migration.body.slice(migration.body.indexOf("create or replace view public.tenant_member_roster"));
  assert.match(view, /left join tenant_agent_availability av/);
  assert.match(view, /av\.user_id is not null or tu\.role::text in \('owner', 'producer', 'setter'\)/);
  assert.match(view, /case when av\.user_id is null then null/);
  const service = read("lib", "setters", "service.ts");
  assert.match(service, /const missing = \(members\.data \?\? \[\]\)\.filter\(\(row\) => row\.accepted_at && !listed\.has\(row\.user_id\)\)/);
  assert.match(service, /hasHours: false/);
});

test("LA-2.11-9 · the in-app reminder and the close-out pass run on pg_cron, checked by running them", () => {
  const migration = latestDefining(/create or replace function public\.run_appointment_in_app_reminders/);
  assert.ok(migration);
  const body = migration.body;
  assert.match(body, /cron\.schedule\('appointment-in-app-reminders', '\* \* \* \* \*'/);
  assert.match(body, /cron\.schedule\('appointment-close-out', '\*\/5 \* \* \* \*'/);
  // The job's own run, rolled back — a pg_cron job that fails at run time fails silently.
  assert.match(body, /perform public\.run_appointment_in_app_reminders\(now\(\), 50\);\s+perform public\.run_appointment_close_out\(now\(\)\);\s+raise exception using errcode = 'P0099'/);
  // The same source key as the app's email job, so the two never double-notify.
  assert.match(body, /'appointment-reminder:' \|\| a\.id::text \|\| ':agent:' \|\| lower\(a\.agent_user_id::text\)/);
  assert.match(read("lib", "appointments", "reminderContract.ts"), /`appointment-reminder:\$\{appointmentId\}:\$\{recipientType\}:\$\{recipientKey\.toLowerCase\(\)\}`/);
  // Its own marker: the email claim (reminder_sent_at) still finds the appointment.
  assert.match(body, /in_app_reminded_at is null/);
  assert.doesNotMatch(body, /set reminder_sent_at/);
  // Not callable from the tenant plane.
  assert.match(body, /revoke all on function public\.run_appointment_in_app_reminders\(timestamptz, integer\) from public, anon, authenticated, tenant_app;/);
});

test("the customer is reminded only with consent and a channel", () => {
  assert.equal(customerReminderAllowed({ email: "pat@example.com", certificateStatuses: ["claimed"] }), true);
  assert.equal(customerReminderAllowed({ email: "pat@example.com", certificateStatuses: ["pending"] }), true);
  assert.equal(customerReminderAllowed({ email: "pat@example.com", certificateStatuses: [] }), false, "an address is not consent");
  assert.equal(customerReminderAllowed({ email: "pat@example.com", certificateStatuses: ["expired", "failed"] }), false);
  assert.equal(customerReminderAllowed({ email: null, certificateStatuses: ["claimed"] }), false, "consent without a channel reaches nobody");
  const job = read("lib", "appointments", "reminders.ts");
  assert.match(job, /from\("tenant_consent_artefacts"\)\.select\("tenant_id, lead_id, capture_status"\)\.in\("tenant_id", tenantIds\)/);
  assert.match(job, /customerReminderAllowed\(\{ email: channel, certificateStatuses: consentByLead\.get\(row\.lead_id\) \?\? \[\] \}\) \? channel : null/);
});

test("LA-2.11-8 · the dashboard lists the appointments on today's diary, not rows created today", () => {
  const today = read("lib", "dashboard", "today.ts");
  assert.match(today, /\.gte\("starts_at_utc", today\.start\)\.lt\("starts_at_utc", todayEnd\)/);
  assert.doesNotMatch(today, /tenant_appointments"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("tenant_id", input\.tenantId\)\.gte\("created_at", today\.start\)/);
  const tile = read("components", "app", "dashboard-today.tsx");
  assert.match(tile, /<TodayAppointments data=\{data\} \/>/);
  assert.match(tile, /label: "Appointments today"/);
});
