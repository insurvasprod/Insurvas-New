import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { BLOCK_REPEATS, type BlockRepeat } from "./calendarMath";
import { isSchemaGap, SchemaGapError } from "./schemaGap";

type Result<T> = { data: T; error: { message: string; code?: string } | null };
type Query<T> = PromiseLike<Result<T>> & {
  select(columns: string): Query<T>;
  eq(column: string, value: unknown): Query<T>;
  in(column: string, values: unknown[]): Query<T>;
  gte(column: string, value: unknown): Query<T>;
  or(filters: string): Query<T>;
  order(column: string, options?: { ascending?: boolean }): Query<T>;
};
type Db = {
  from(table: string): Query<Array<Record<string, unknown>>>;
  rpc(name: string, args: Record<string, unknown>): Promise<Result<unknown>>;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * LA-2.11 / LA-2.12 · the booking calls the product never made.
 *
 * `book_appointment` and `reschedule_appointment` have been live and correct, and **neither had a
 * single caller**. That is the third finished mechanism found unreachable in this sweep, and it is
 * the most complete of the three: the function already enforces every LA-2.11 acceptance criterion
 * — the customer's legal window at the booked instant, the agent's working hours, blocked time, the
 * daily cap counted in the agent's own day, and the slot race resolved by an exclusion constraint
 * rather than a stale client-side slot list. It also notifies Ray, idempotently, and only when
 * somebody else did the booking.
 *
 * None of it could happen, because a setter had no way to book. LA-2.12 is named for a workflow —
 * "setter dials → qualifies → books a slot on Ray's calendar" — whose last step did not exist.
 *
 * The error codes are re-thrown unchanged. Each one is a different thing for the setter to do about
 * it, and collapsing them into "could not book" would leave somebody guessing which rule they hit.
 */
export const BOOKING_REFUSALS: Record<string, readonly [number, string]> = {
  APPOINTMENT_IN_THE_PAST: [400, "That time has already passed. Choose a later slot."],
  APPOINTMENT_LEAD_HAS_NO_STATE: [
    409,
    "This lead has no state, so there is no timezone to book in and no legal window to check. Add the state first.",
  ],
  APPOINTMENT_OUTSIDE_CUSTOMER_WINDOW: [
    422,
    "That time is outside the customer's legal calling window. An appointment is a call, so it has to be inside it.",
  ],
  APPOINTMENT_OUTSIDE_AVAILABILITY: [422, "That time is outside the agent's working hours."],
  // 20260925704000 · decided 2026-09-25: an agent with no working hours cannot be booked at all.
  APPOINTMENT_AGENT_HAS_NO_HOURS: [
    422,
    "This agent has no working hours set, so there is no slot to book. They add their hours in Settings › Calendar & availability.",
  ],
  // reschedule_appointment and rebook_appointment (20260925704200).
  APPOINTMENT_NOT_FOUND: [404, "That appointment no longer exists. Refresh the calendar."],
  APPOINTMENT_NOT_ACTIVE: [
    409,
    "That appointment has already been closed out, cancelled or moved, so it cannot be rescheduled.",
  ],
  APPOINTMENT_NOT_A_NO_SHOW: [409, "Only a no-show can be rebooked. Reschedule an appointment that is still booked."],
  APPOINTMENT_ALREADY_REBOOKED: [409, "This no-show has already been rebooked. Move that appointment instead."],
  APPOINTMENT_BLOCKED_TIME: [409, "The agent has blocked that time."],
  // 20260924120000 · the agent turned off same-day booking in Calendar & availability.
  APPOINTMENT_SAME_DAY_NOT_ALLOWED: [409, "This agent does not take same-day appointments. Choose a later day."],
  APPOINTMENT_DAILY_CAP_REACHED: [
    409,
    "The agent is already at their appointment limit for that day. Choose another day.",
  ],
  // 20260924230200 · the agency-wide "Maximum per day" in Calendar & availability.
  APPOINTMENT_AGENCY_DAILY_CAP_REACHED: [
    409,
    "The agency is already at its appointment limit for that day. Choose another day.",
  ],
  // 20260924230200 · busy time in the agent's connected Google or Outlook calendar.
  APPOINTMENT_LINKED_CALENDAR_BUSY: [409, "The agent's linked calendar is busy then. Choose another time."],
  // 20260924230100 · the state calling rules are stale, so no call — booked or dialled — is allowed.
  APPOINTMENT_CALLING_RULES_STALE: [
    503,
    "The state calling rules are out of date, so no call can be booked until the platform refreshes them.",
  ],
  // The race. LA-2.11 criterion 1 is "one succeeds, one is told it went" — so this message says
  // the slot went, not that something failed.
  APPOINTMENT_SLOT_TAKEN: [409, "That slot was taken while you were booking it. Choose another."],
};

export type BookedAppointment = {
  appointmentId: string;
  startsAtUtc: string;
  durationMinutes: number;
  reason: string;
};

export async function bookAppointment(input: {
  tenantId: string;
  leadId: string;
  agentUserId: string;
  bookedBy: string;
  startsAtUtc: string;
  notes?: string | null;
  durationMinutes?: number | null;
}): Promise<BookedAppointment> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const result = await db.rpc("book_appointment", {
    p_tenant_id: input.tenantId,
    p_lead_id: input.leadId,
    p_agent_user_id: input.agentUserId,
    p_booked_by: input.bookedBy,
    p_starts_at_utc: input.startsAtUtc,
    p_notes: input.notes ?? null,
    p_duration_minutes: input.durationMinutes ?? null,
  });
  if (result.error) throw new Error(result.error.message);

  const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("APPOINTMENT_NOT_RETURNED");
  return {
    appointmentId: text(row.appointment_id),
    startsAtUtc: text(row.starts_at_utc),
    durationMinutes: Number(row.duration_minutes ?? 0),
    reason: text(row.reason),
  };
}

export async function rescheduleAppointment(input: {
  tenantId: string;
  appointmentId: string;
  actorId: string;
  startsAtUtc: string;
}): Promise<void> {
  const db = getSupabaseServiceClient() as unknown as Db;
  // The old slot is freed inside the same statement that takes the new one — LA-2.11 criterion 5.
  // Doing it here as a delete-then-insert would open a window in which the agent has no
  // appointment and another setter can take the slot they were moving to.
  const result = await db.rpc("reschedule_appointment", {
    p_tenant_id: input.tenantId,
    p_appointment_id: input.appointmentId,
    p_actor: input.actorId,
    p_starts_at_utc: input.startsAtUtc,
  });
  if (result.error) throw new Error(result.error.message);
}

/**
 * Rebook a no-show (20260925704200). The no-show stays a no-show; the new appointment is booked
 * through `book_appointment` with every rule, `booked_by` is whoever rebooks it, and it points back
 * at the no-show through `rebooked_from`. Before the migration the function does not exist, and
 * that is a SchemaGapError the route answers with 503.
 */
export async function rebookAppointment(input: {
  tenantId: string;
  appointmentId: string;
  actorId: string;
  startsAtUtc: string;
  agentUserId?: string | null;
}): Promise<BookedAppointment> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const result = await db.rpc("rebook_appointment", {
    p_tenant_id: input.tenantId,
    p_appointment_id: input.appointmentId,
    p_actor: input.actorId,
    p_starts_at_utc: input.startsAtUtc,
    p_agent_user_id: input.agentUserId ?? null,
  });
  if (result.error) {
    if (isSchemaGap(result.error) || /could not find the function/i.test(result.error.message)) throw new SchemaGapError();
    throw new Error(result.error.message);
  }
  const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("APPOINTMENT_NOT_RETURNED");
  return {
    appointmentId: text(row.appointment_id),
    startsAtUtc: text(row.starts_at_utc),
    durationMinutes: Number(row.duration_minutes ?? 0),
    reason: text(row.reason),
  };
}

/** A setter books into a calendar but is not told why its owner is away (decided 2026-09-25). */
export const HIDDEN_BLOCK_REASON = "Unavailable";

export function redactBlocksForSetter(context: BookableContext): BookableContext {
  return { ...context, blocks: context.blocks.map((block) => ({ ...block, reason: HIDDEN_BLOCK_REASON })) };
}

export type BookableContext = {
  agents: Array<{ userId: string; name: string; timezone: string | null }>;
  availability: Array<{ userId: string; weekday: number; startTime: string; endTime: string; timezone: string }>;
  /** One-off blocks that have not ended, and every repeating block (its first date may be past). */
  blocks: Array<{ userId: string; startsAt: string; endsAt: string; reason: string | null; repeats: BlockRepeat }>;
  policy: Array<{
    userId: string;
    appointmentMinutes: number | null;
    bufferMinutes: number | null;
    maxPerDay: number | null;
    allowSameDay: boolean;
    allowDoubleBooking: boolean;
  }>;
  upcoming: Array<{ appointmentId: string; agentUserId: string; leadId: string; startsAtUtc: string; durationMinutes: number; status: string; notes: string | null }>;
  /** Busy time from connected Google / Outlook calendars, for agents who honour it (20260924230200). */
  busy: Array<{ userId: string; startsAt: string; endsAt: string }>;
};

/**
 * Everything a slot picker needs to propose times, in one round trip.
 *
 * The client composes candidate slots from this (`openSlots` in calendarMath.ts) and the server
 * refuses anything wrong — it is not the authority. LA-2.11 is explicit that double-booking "must
 * be resolved by the database with a constraint, not by a client-side check on a stale slot list",
 * so this payload exists to make the picker *helpful*, never to make it *trusted*.
 *
 * It carries the rules the picker used to miss: repeating blocks (the old read kept only blocks
 * whose stored instant had not ended, which drops every repeating block after its first
 * occurrence), the same-day switch, double-booking and linked-calendar busy time. Each newer column
 * degrades to the older read when its migration is not applied.
 */
export async function bookableContext(tenantId: string): Promise<BookableContext> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const nowIso = new Date().toISOString();

  const readBlocks = () =>
    db.from("tenant_agent_blocks").select("user_id, starts_at, ends_at, reason, repeats").eq("tenant_id", tenantId).or(`ends_at.gte."${nowIso}",repeats.neq.none`);
  const readPolicy = (columns: string) =>
    db.from("tenant_agent_booking_policy").select(columns).eq("tenant_id", tenantId);

  const [availability, firstBlocks, firstPolicy, upcoming, busyRows] = await Promise.all([
    db.from("tenant_agent_availability").select("user_id, weekday, start_time, end_time, timezone").eq("tenant_id", tenantId),
    readBlocks(),
    readPolicy("user_id, appointment_minutes, buffer_minutes, max_per_day, allow_same_day, honour_linked_calendars, allow_double_booking"),
    db.from("tenant_appointments").select("id, agent_user_id, lead_id, starts_at_utc, duration_minutes, status, notes").eq("tenant_id", tenantId).gte("starts_at_utc", nowIso).order("starts_at_utc", { ascending: true }),
    db.from("tenant_calendar_busy").select("user_id, starts_at, ends_at, tenant_connected_calendars!inner(status)").eq("tenant_id", tenantId).eq("tenant_connected_calendars.status", "connected").gte("ends_at", nowIso),
  ]);

  const blocks = isSchemaGap(firstBlocks.error)
    ? await db.from("tenant_agent_blocks").select("user_id, starts_at, ends_at, reason").eq("tenant_id", tenantId).gte("ends_at", nowIso)
    : firstBlocks;
  let policy = firstPolicy;
  if (isSchemaGap(policy.error)) policy = await readPolicy("user_id, appointment_minutes, buffer_minutes, max_per_day, allow_same_day, honour_linked_calendars");
  if (isSchemaGap(policy.error)) policy = await readPolicy("user_id, appointment_minutes, buffer_minutes, max_per_day");

  // Reported, never swallowed. A picker rendered from an empty availability list looks exactly like
  // an agent who has not set their hours, and those need different answers. Busy time is the one
  // exception: before its migration there is simply none.
  for (const [label, response] of [
    ["availability", availability],
    ["blocked time", blocks],
    ["booking policy", policy],
    ["upcoming appointments", upcoming],
  ] as const) {
    if (response.error) throw new Error(`Could not load ${label}: ${response.error.message}`);
  }
  if (busyRows.error && !isSchemaGap(busyRows.error)) throw new Error(`Could not load linked-calendar busy time: ${busyRows.error.message}`);

  const userIds = [
    ...new Set((availability.data ?? []).map((row) => text(row.user_id)).filter(Boolean)),
  ];
  const users = userIds.length
    ? await db.from("users").select("id, name").in("id", userIds)
    : ({ data: [], error: null } as Result<Array<Record<string, unknown>>>);
  if (users.error) throw new Error(`Could not load agents: ${users.error.message}`);

  const zoneByUser = new Map<string, string>();
  for (const row of availability.data ?? []) {
    if (!zoneByUser.has(text(row.user_id))) zoneByUser.set(text(row.user_id), text(row.timezone));
  }
  const policies = (policy.data ?? []).map((row) => ({
    userId: text(row.user_id),
    appointmentMinutes: row.appointment_minutes == null ? null : Number(row.appointment_minutes),
    bufferMinutes: row.buffer_minutes == null ? null : Number(row.buffer_minutes),
    maxPerDay: row.max_per_day == null ? null : Number(row.max_per_day),
    allowSameDay: row.allow_same_day !== false,
    allowDoubleBooking: row.allow_double_booking === true,
    honour: row.honour_linked_calendars !== false,
  }));
  const honours = new Set(policies.filter((row) => row.honour).map((row) => row.userId));
  const knownPolicy = new Set(policies.map((row) => row.userId));

  return {
    agents: (users.data ?? []).map((row) => ({
      userId: text(row.id),
      name: text(row.name) || "Agent",
      timezone: zoneByUser.get(text(row.id)) ?? null,
    })),
    availability: (availability.data ?? []).map((row) => ({
      userId: text(row.user_id),
      weekday: Number(row.weekday ?? 0),
      startTime: text(row.start_time),
      endTime: text(row.end_time),
      timezone: text(row.timezone),
    })),
    blocks: (blocks.data ?? []).map((row) => ({
      userId: text(row.user_id),
      startsAt: text(row.starts_at),
      endsAt: text(row.ends_at),
      reason: text(row.reason) || null,
      repeats: (BLOCK_REPEATS as readonly string[]).includes(text(row.repeats)) ? (text(row.repeats) as BlockRepeat) : "none",
    })),
    policy: policies.map((row) => ({
      userId: row.userId,
      appointmentMinutes: row.appointmentMinutes,
      bufferMinutes: row.bufferMinutes,
      maxPerDay: row.maxPerDay,
      allowSameDay: row.allowSameDay,
      allowDoubleBooking: row.allowDoubleBooking,
    })),
    upcoming: (upcoming.data ?? []).map((row) => ({
      appointmentId: text(row.id),
      agentUserId: text(row.agent_user_id),
      leadId: text(row.lead_id),
      startsAtUtc: text(row.starts_at_utc),
      durationMinutes: Number(row.duration_minutes ?? 0),
      status: text(row.status),
      notes: text(row.notes) || null,
    })),
    // An agent with no policy row runs the column default, which honours linked calendars.
    busy: (busyRows.error ? [] : busyRows.data ?? [])
      .filter((row) => honours.has(text(row.user_id)) || !knownPolicy.has(text(row.user_id)))
      .map((row) => ({ userId: text(row.user_id), startsAt: text(row.starts_at), endsAt: text(row.ends_at) })),
  };
}
