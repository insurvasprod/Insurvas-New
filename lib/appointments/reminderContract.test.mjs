import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appointmentReminderEventKey, appointmentReminderTimes } from "./reminderContract.ts";

test("appointment reminders render the same instant in both recipient timezones", () => {
  const result = appointmentReminderTimes({
    startsAtUtc: "2026-09-15T16:00:00.000Z",
    customerTimezone: "America/Phoenix",
    agentTimezone: "America/New_York",
  });
  assert.match(result.customerLocal, /Sep 15, 2026/);
  assert.match(result.agentLocal, /Sep 15, 2026/);
  assert.notEqual(result.customerLocal, result.agentLocal);
  assert.equal(result.customerTimezone, "America/Phoenix");
  assert.equal(result.agentTimezone, "America/New_York");
});

test("recipient event keys are stable and distinct", () => {
  const base = appointmentReminderEventKey("appointment-1", "agent", "user-1");
  assert.equal(base, appointmentReminderEventKey("appointment-1", "agent", "user-1"));
  assert.notEqual(base, appointmentReminderEventKey("appointment-1", "customer", "user-1"));
});

test("the migration claims once, keeps recipient history, and restricts execution", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260914150000_la_2_11_appointment_reminders.sql", import.meta.url), "utf8");
  assert.match(migration, /create table if not exists public\.tenant_appointment_reminder_events/i);
  assert.match(migration, /unique \(appointment_id, recipient_type, recipient_key\)/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /reminder_sent_at is null/i);
  assert.match(migration, /revoke all on function public\.claim_appointment_reminders/i);
  assert.match(migration, /grant execute on function public\.claim_appointment_reminders[\s\S]*to service_role/i);
});
