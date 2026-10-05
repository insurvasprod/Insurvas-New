import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { faceAmountCents, productLabel } from "./appointmentFacts";
import { isSchemaGap } from "./schemaGap";

/**
 * The diary. LA-2.11 asks for a day and week calendar and there was never a screen for either —
 * appointments could be booked from the dialer and then only existed as rows.
 *
 * Read over a range rather than "upcoming", which is what `bookableContext` returns for the slot
 * picker. A calendar has to be able to look backwards: yesterday's no-show is the thing you check
 * first, and the close-out strip sends you to a slot that has already passed.
 */

export type CalendarAppointment = {
  appointmentId: string;
  leadId: string;
  customerName: string;
  agentUserId: string;
  agentName: string;
  startsAtUtc: string;
  durationMinutes: number;
  customerTimezone: string;
  status: string;
  notes: string | null;
  bookedByUserId: string | null;
  bookedByName: string | null;
  /** LA-2 §11 concept: what the appointment is for, from the lead — never a figure the lead lacks. */
  product: string | null;
  faceAmountCents: number | null;
  /** When the agent's reminder went out (claim_appointment_reminders), or null. */
  reminderSentAt: string | null;
  /** 20260925704200: the no-show this appointment rebooks, and — for a no-show — its live rebooking. */
  rebookedFrom: string | null;
  rebookedAs: string | null;
  /** True when a setter is looking at another setter's booking: the slot is shown, the lead is not. */
  redacted?: boolean;
};

/**
 * LA-2.12-2 · what a setter sees of the diary. Their own bookings in full. Everybody else's as a
 * taken slot on the agent's calendar: no customer, no lead, no notes, no product, and not who
 * booked it — "cannot see other setters' leads". The time and the status stay, because a setter
 * booking into a slot they cannot see as taken is how two people end up in the same hour.
 */
export const REDACTED_CUSTOMER = "Booked";

export function redactCalendarForSetter(rows: CalendarAppointment[], viewerId: string): CalendarAppointment[] {
  return rows.map((row) =>
    row.bookedByUserId === viewerId
      ? row
      : {
          ...row,
          leadId: "",
          customerName: REDACTED_CUSTOMER,
          notes: null,
          bookedByUserId: null,
          bookedByName: null,
          product: null,
          faceAmountCents: null,
          rebookedFrom: null,
          rebookedAs: null,
          redacted: true,
        },
  );
}

type Row = Record<string, unknown>;
type Result<T> = { data: T; error: { message: string; code?: string } | null };
type Query<T> = PromiseLike<Result<T>> & {
  select(columns: string): Query<T>;
  eq(column: string, value: unknown): Query<T>;
  in(column: string, values: unknown[]): Query<T>;
  gte(column: string, value: unknown): Query<T>;
  lt(column: string, value: unknown): Query<T>;
  order(column: string, options?: { ascending?: boolean }): Query<T>;
};
type Db = { from(table: string): Query<Row[]> };

const text = (value: unknown) => (typeof value === "string" ? value : "");
const BASE_COLUMNS = "id, lead_id, agent_user_id, booked_by, starts_at_utc, duration_minutes, customer_timezone, status, notes, reminder_sent_at";
/** A rebooking that still stands; a cancelled or moved one frees the no-show again. */
const LIVE_REBOOKING = ["booked", "confirmed", "pending", "showed"];

export async function appointmentsInRange(
  tenantId: string,
  fromIso: string,
  toIso: string,
): Promise<CalendarAppointment[]> {
  const db = getSupabaseServiceClient() as unknown as Db;

  // `lt` on the upper bound, not `lte`: a week runs to the start of the next one, and an
  // appointment at exactly midnight belongs to the day it starts rather than to both.
  const read = (columns: string) => db
    .from("tenant_appointments")
    .select(columns)
    .eq("tenant_id", tenantId)
    .gte("starts_at_utc", fromIso)
    .lt("starts_at_utc", toIso)
    .order("starts_at_utc", { ascending: true });
  // `rebooked_from` arrives with 20260925704200 and `in_app_reminded_at` (the pg_cron reminder)
  // with 20260929202000; before each, the calendar reads as it did.
  let appointments = await read(`${BASE_COLUMNS}, rebooked_from, in_app_reminded_at`);
  if (isSchemaGap(appointments.error)) appointments = await read(`${BASE_COLUMNS}, rebooked_from`);
  const hasRebook = !isSchemaGap(appointments.error);
  if (!hasRebook) appointments = await read(BASE_COLUMNS);
  if (appointments.error) throw new Error(`Could not load the calendar: ${appointments.error.message}`);
  const rows = appointments.data ?? [];
  if (rows.length === 0) return [];

  const leadIds = [...new Set(rows.map((row) => text(row.lead_id)).filter(Boolean))];
  const userIds = [
    ...new Set(rows.flatMap((row) => [text(row.agent_user_id), text(row.booked_by)]).filter(Boolean)),
  ];
  const noShowIds = rows.filter((row) => text(row.status) === "no_show").map((row) => text(row.id));

  const [leads, users, rebookings] = await Promise.all([
    leadIds.length ? db.from("agent_leads").select("id, values, product_line").in("id", leadIds) : Promise.resolve({ data: [], error: null } as Result<Row[]>),
    userIds.length ? db.from("users").select("id, name").in("id", userIds) : Promise.resolve({ data: [], error: null } as Result<Row[]>),
    hasRebook && noShowIds.length
      ? db.from("tenant_appointments").select("id, rebooked_from").eq("tenant_id", tenantId).in("rebooked_from", noShowIds).in("status", LIVE_REBOOKING)
      : Promise.resolve({ data: [], error: null } as Result<Row[]>),
  ]);
  // Reported, never swallowed. A calendar of appointments all labelled "Unnamed" because a lookup
  // failed looks exactly like a calendar of leads with no names on them.
  if (leads.error) throw new Error(`Could not load the customers on the calendar: ${leads.error.message}`);
  if (users.error) throw new Error(`Could not load the agents on the calendar: ${users.error.message}`);
  if (rebookings.error) throw new Error(`Could not load rebooked appointments: ${rebookings.error.message}`);

  const leadById = new Map((leads.data ?? []).map((row) => [text(row.id), row]));
  const nameOfLead = (leadId: string) => {
    const values = (leadById.get(leadId)?.values ?? {}) as Record<string, unknown>;
    return text(values.full_name) || [text(values.first_name), text(values.last_name)].filter(Boolean).join(" ") || "Unnamed lead";
  };
  const nameOfUser = new Map((users.data ?? []).map((row) => [text(row.id), text(row.name) || "Member"]));
  const rebookedAs = new Map((rebookings.data ?? []).map((row) => [text(row.rebooked_from), text(row.id)]));

  return rows.map((row) => {
    const lead = leadById.get(text(row.lead_id));
    const values = (lead?.values ?? {}) as Record<string, unknown>;
    return {
      appointmentId: text(row.id),
      leadId: text(row.lead_id),
      customerName: nameOfLead(text(row.lead_id)),
      agentUserId: text(row.agent_user_id),
      agentName: nameOfUser.get(text(row.agent_user_id)) ?? "Unassigned",
      startsAtUtc: text(row.starts_at_utc),
      durationMinutes: Number(row.duration_minutes ?? 30),
      customerTimezone: text(row.customer_timezone),
      status: text(row.status) || "booked",
      notes: text(row.notes) || null,
      bookedByUserId: text(row.booked_by) || null,
      // Who booked it is the point of the field — Ray, or which setter. A calendar that does not say
      // cannot answer "whose appointments never show", which is LA-2.12's whole argument.
      bookedByName: text(row.booked_by) ? nameOfUser.get(text(row.booked_by)) ?? "Member" : null,
      product: productLabel(text(lead?.product_line) || text(values.product_line)),
      faceAmountCents: faceAmountCents(values),
      // Whichever reminder went first: the agent's in-app alert (pg_cron) or the app's email job.
      reminderSentAt: text(row.in_app_reminded_at) || text(row.reminder_sent_at) || null,
      rebookedFrom: text(row.rebooked_from) || null,
      rebookedAs: rebookedAs.get(text(row.id)) ?? null,
    };
  });
}
