import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { SchemaGapError, isSchemaGap } from "./schemaGap";
import { BLOCK_REPEATS, type BlockRepeat } from "./calendarMath";

/**
 * LA-2.11 · reading and writing the calendar that every booking rule depends on.
 *
 * `tenant_agent_availability`, `tenant_agent_blocks` and `tenant_agent_booking_policy` shipped with
 * the calendar migration and, until this file, **nothing in the product wrote any of them**. They
 * had exactly two readers — `bookableContext` and `book_appointment` — and no writer anywhere, so
 * all three were empty on the live project and stayed that way.
 *
 * That is not a cosmetic gap, because each rule is written to skip itself when its row is missing:
 *
 *   - `book_appointment` reads the agent's zone from availability and, if there is none, skips the
 *     working-hours check AND the blocked-time check entirely. LA-2.11 criterion 2's first half
 *     could never fire.
 *   - The daily cap is guarded by `if v_policy.max_per_day is not null`, and with no policy row it
 *     is null. Criterion 3 could never fire.
 *   - `tenant_member_roster` INNER JOINs availability, so LA-2.12 criterion 6's roster was empty
 *     for every tenant.
 *   - The reminder job falls back to `"UTC"` for the agent's zone, so criterion 6's "right timezone
 *     for each recipient" was UTC wearing the agent's label.
 *   - `bookableContext` derives its agent list from availability rows, so the dialer's booking card
 *     is hidden — and LA-2.12's whole "setter dials → qualifies → books a slot" flow had no door.
 *
 * One missing editor, five criteria. Writing it is the fix for all of them.
 */

export type WorkingHours = { weekday: number; startTime: string; endTime: string };
export type BlockedTime = { id?: string; startsAt: string; endsAt: string; reason: string | null; repeats: BlockRepeat };
export type BookingPolicy = {
  appointmentMinutes: number;
  bufferMinutes: number;
  maxPerDay: number;
  /** Enforced by `book_appointment` (20260924120000). */
  allowSameDay: boolean;
  /**
   * Enforced by `book_appointment` (20260924230200) against busy time synced from a CONNECTED
   * Google or Outlook calendar. With none connected there is no busy time, and the screen says so.
   */
  honourLinkedCalendars: boolean;
  /** Two appointments in one slot, settled seat by seat by the exclusion constraint (20260924230200). */
  allowDoubleBooking: boolean;
};

/** Settings that belong to the agency, not to one member (20260924230200). */
/**
 * callbackReminderMinutes (20260925711600): how long before a callback its reminder goes out, for
 * the whole agency (LA-1.22 / LA-2.10 "reminder at a configurable lead time"); null = the platform
 * default. Absent until that migration is applied, which the screen reads as "not available yet".
 */
export type AgencyBookingSettings = { maxPerDay: number | null; callbackReminderMinutes?: number | null };

export type CalendarSettings = {
  userId: string;
  name: string;
  role: string;
  timezone: string | null;
  hours: WorkingHours[];
  blocks: BlockedTime[];
  policy: BookingPolicy;
};

/** The defaults the columns already declare, so an unconfigured member reads the same either way. */
export const POLICY_DEFAULTS: BookingPolicy = {
  appointmentMinutes: 30,
  bufferMinutes: 0,
  maxPerDay: 8,
  allowSameDay: true,
  honourLinkedCalendars: true,
  allowDoubleBooking: false,
};

/**
 * `settingsReady` is false until 20260924120000 is applied (the recurrence column and the
 * same-day and linked-calendar switches). `bookingReady` is false until 20260924230200 is applied
 * (double-booking, the agency-wide cap, linked calendars). The screen says which settings cannot
 * be saved yet rather than failing to load.
 */
export type CalendarSchema = { settingsReady: boolean; bookingReady: boolean };

/** The members whose calendars are worth configuring: the people a lead can be booked with. */
const BOOKABLE_ROLES = ["owner", "producer"];

/**
 * The same shim `booking.ts` uses, for the same reason: these three tables were added by the
 * LA-2.11 migration and are not in the generated types until they are regenerated against the
 * shared project. Narrow on purpose — it names the operations this file performs and nothing else,
 * so it cannot quietly become an escape hatch for untyped access to the rest of the schema.
 */
type Result<T> = { data: T; error: { message: string; code?: string } | null };
type Query<T> = PromiseLike<Result<T>> & {
  select(columns: string): Query<T>;
  eq(column: string, value: unknown): Query<T>;
  in(column: string, values: unknown[]): Query<T>;
  not(column: string, operator: string, value: unknown): Query<T>;
  order(column: string, options?: { ascending?: boolean }): Query<T>;
  delete(): Query<T>;
  update(values: Record<string, unknown>): Query<T>;
  insert(rows: Array<Record<string, unknown>>): Query<T>;
  upsert(rows: Record<string, unknown> | Array<Record<string, unknown>>, options?: { onConflict?: string }): Query<T>;
};
type Loose = { from(table: string): Query<Array<Record<string, unknown>>> };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** `09:00:00` and `09:00` both arrive; the inputs emit the short form and Postgres emits the long. */
function hhmm(value: unknown): string {
  const raw = text(value);
  return /^\d{2}:\d{2}/.test(raw) ? raw.slice(0, 5) : "";
}

function repeatOf(value: unknown): BlockRepeat {
  return (BLOCK_REPEATS as readonly string[]).includes(text(value)) ? (text(value) as BlockRepeat) : "none";
}

/** The agency-wide cap, or `ready: false` before 20260924230200. */
async function readAgencySettings(db: Loose, tenantId: string): Promise<{ ready: boolean; agency: AgencyBookingSettings }> {
  let result = await db.from("tenant_booking_settings").select("max_per_day, callback_reminder_minutes").eq("tenant_id", tenantId);
  const reminderReady = !isSchemaGap(result.error);
  if (!reminderReady) result = await db.from("tenant_booking_settings").select("max_per_day").eq("tenant_id", tenantId);
  if (isSchemaGap(result.error)) return { ready: false, agency: { maxPerDay: null } };
  if (result.error) throw new Error(`Could not load the agency's booking settings: ${result.error.message}`);
  const row = (result.data ?? [])[0];
  const agency: AgencyBookingSettings = { maxPerDay: row && row.max_per_day != null ? Number(row.max_per_day) : null };
  if (reminderReady) agency.callbackReminderMinutes = row && row.callback_reminder_minutes != null ? Number(row.callback_reminder_minutes) : null;
  return { ready: true, agency };
}

export async function getCalendarSettings(
  tenantId: string,
): Promise<{ members: CalendarSettings[]; schema: CalendarSchema; agency: AgencyBookingSettings }> {
  const db = getSupabaseServiceClient() as unknown as Loose;
  const agencyRead = await readAgencySettings(db, tenantId);

  const members = await db
    .from("tenant_users")
    .select("user_id, role")
    .eq("tenant_id", tenantId)
    .not("accepted_at", "is", null);
  if (members.error) throw new Error(`Could not load members: ${members.error.message}`);

  const bookable = (members.data ?? []).filter((row) => BOOKABLE_ROLES.includes(text(row.role)));
  const userIds = bookable.map((row) => text(row.user_id));
  if (userIds.length === 0)
    return { members: [], schema: { settingsReady: true, bookingReady: agencyRead.ready }, agency: agencyRead.agency };

  const readBlocks = (columns: string) =>
    db.from("tenant_agent_blocks").select(columns).eq("tenant_id", tenantId).order("starts_at", { ascending: true });
  const readPolicies = (columns: string) =>
    db.from("tenant_agent_booking_policy").select(columns).eq("tenant_id", tenantId);

  const [users, hours, firstBlocks, firstPolicies] = await Promise.all([
    db.from("users").select("id, name").in("id", userIds),
    db.from("tenant_agent_availability").select("user_id, weekday, start_time, end_time, timezone").eq("tenant_id", tenantId),
    readBlocks("id, user_id, starts_at, ends_at, reason, repeats"),
    readPolicies("user_id, appointment_minutes, buffer_minutes, max_per_day, allow_same_day, honour_linked_calendars, allow_double_booking"),
  ]);
  // Before a migration its columns are simply absent: read the older shape and report it, so the
  // screen can say why those settings are not saveable yet rather than failing to load at all.
  // 20260924230200 adds `allow_double_booking`; 20260924120000 the two switches before it.
  let policies = firstPolicies;
  let bookingReady = agencyRead.ready && !isSchemaGap(firstPolicies.error);
  if (isSchemaGap(policies.error)) {
    policies = await readPolicies("user_id, appointment_minutes, buffer_minutes, max_per_day, allow_same_day, honour_linked_calendars");
    bookingReady = false;
  }
  const policiesSettingsReady = !isSchemaGap(policies.error);
  if (isSchemaGap(policies.error)) policies = await readPolicies("user_id, appointment_minutes, buffer_minutes, max_per_day");
  const settingsReady = !isSchemaGap(firstBlocks.error) && policiesSettingsReady;
  const blocks = isSchemaGap(firstBlocks.error) ? await readBlocks("id, user_id, starts_at, ends_at, reason") : firstBlocks;
  // Reported, never swallowed. An empty hours list because a query failed looks exactly like a
  // member who has not set their hours, and those two need different answers on screen.
  for (const [label, response] of [
    ["members", users],
    ["working hours", hours],
    ["blocked time", blocks],
    ["booking policy", policies],
  ] as const) {
    if (response.error) throw new Error(`Could not load ${label}: ${response.error.message}`);
  }

  const nameById = new Map((users.data ?? []).map((row) => [text(row.id), text(row.name) || "Member"]));
  const roleById = new Map(bookable.map((row) => [text(row.user_id), text(row.role)]));

  const settings = userIds.map((userId) => {
    const own = (hours.data ?? []).filter((row) => text(row.user_id) === userId);
    const policy = (policies.data ?? []).find((row) => text(row.user_id) === userId);
    return {
      userId,
      name: nameById.get(userId) ?? "Member",
      role: roleById.get(userId) ?? "producer",
      timezone: own[0] ? text(own[0].timezone) : null,
      hours: own
        .map((row) => ({ weekday: Number(row.weekday ?? 0), startTime: hhmm(row.start_time), endTime: hhmm(row.end_time) }))
        .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)),
      blocks: (blocks.data ?? [])
        .filter((row) => text(row.user_id) === userId)
        .map((row) => ({
          id: text(row.id),
          startsAt: text(row.starts_at),
          endsAt: text(row.ends_at),
          reason: text(row.reason) || null,
          repeats: repeatOf(row.repeats),
        })),
      policy: policy
        ? {
            appointmentMinutes: Number(policy.appointment_minutes ?? POLICY_DEFAULTS.appointmentMinutes),
            bufferMinutes: Number(policy.buffer_minutes ?? POLICY_DEFAULTS.bufferMinutes),
            maxPerDay: Number(policy.max_per_day ?? POLICY_DEFAULTS.maxPerDay),
            allowSameDay: policy.allow_same_day !== false,
            honourLinkedCalendars: policy.honour_linked_calendars !== false,
            allowDoubleBooking: policy.allow_double_booking === true,
          }
        : { ...POLICY_DEFAULTS },
    };
  });
  return { members: settings, schema: { settingsReady, bookingReady }, agency: agencyRead.agency };
}

/**
 * The agency-wide cap and callback reminder lead. Owners only (the route checks); refuses before
 * 20260924230200 (and before 20260925711600 for the reminder). A field left undefined is unchanged.
 */
export async function saveAgencyBookingSettings(input: { tenantId: string; userId: string; maxPerDay?: number | null; callbackReminderMinutes?: number | null }): Promise<void> {
  const db = getSupabaseServiceClient() as unknown as Loose;
  const row: Record<string, unknown> = { tenant_id: input.tenantId, updated_at: new Date().toISOString(), updated_by: input.userId };
  if (input.maxPerDay !== undefined) row.max_per_day = input.maxPerDay;
  if (input.callbackReminderMinutes !== undefined) row.callback_reminder_minutes = input.callbackReminderMinutes;
  const saved = await db.from("tenant_booking_settings").upsert(row, { onConflict: "tenant_id" });
  if (isSchemaGap(saved.error)) throw new SchemaGapError();
  if (saved.error) throw new Error(`Could not save the agency's booking settings: ${saved.error.message}`);
}

/** True when a write only uses what the pre-migration schema can already hold. */
function fitsLegacySchema(input: CalendarWrite): boolean {
  return (
    input.blocks.every((block) => block.repeats === "none") &&
    input.policy.allowSameDay === POLICY_DEFAULTS.allowSameDay &&
    input.policy.honourLinkedCalendars === POLICY_DEFAULTS.honourLinkedCalendars &&
    input.policy.allowDoubleBooking === POLICY_DEFAULTS.allowDoubleBooking
  );
}

/**
 * Refuse, before anything is written, a save the deployed schema cannot hold. Without this a
 * repeating block on the old schema was refused only after the working hours had already been
 * rewritten — half a save, reported as a failure.
 */
async function assertSchemaFits(db: Loose, input: CalendarWrite): Promise<void> {
  if (fitsLegacySchema(input)) return;
  const needs120000 =
    input.blocks.some((block) => block.repeats !== "none") ||
    input.policy.allowSameDay !== POLICY_DEFAULTS.allowSameDay ||
    input.policy.honourLinkedCalendars !== POLICY_DEFAULTS.honourLinkedCalendars;
  if (needs120000) {
    const [blocks, policy] = await Promise.all([
      db.from("tenant_agent_blocks").select("repeats").eq("tenant_id", input.tenantId).eq("user_id", input.userId),
      db.from("tenant_agent_booking_policy").select("allow_same_day, honour_linked_calendars").eq("tenant_id", input.tenantId).eq("user_id", input.userId),
    ]);
    if (isSchemaGap(blocks.error) || isSchemaGap(policy.error)) throw new SchemaGapError();
  }
  if (input.policy.allowDoubleBooking !== POLICY_DEFAULTS.allowDoubleBooking) {
    const probe = await db.from("tenant_agent_booking_policy").select("allow_double_booking").eq("tenant_id", input.tenantId).eq("user_id", input.userId);
    if (isSchemaGap(probe.error)) throw new SchemaGapError();
  }
}

export type CalendarWrite = {
  tenantId: string;
  userId: string;
  timezone: string;
  hours: WorkingHours[];
  blocks: BlockedTime[];
  policy: BookingPolicy;
};

/**
 * Replaces one member's calendar.
 *
 * **The write order is the safety property, not an implementation detail.** Every rule in
 * `book_appointment` fails OPEN when its row is missing — no availability means no working-hours
 * check at all — so a half-applied save that deleted before it inserted would leave the agent
 * bookable at any hour, which is worse than the save not happening. Each collection is therefore
 * written before anything is removed, and a failure leaves the previous configuration standing.
 *
 * There is no RPC to do this in one transaction because this environment cannot apply DDL. The
 * ordering is the mitigation, and the failure it still admits — stale rows surviving a failed
 * delete — leaves the calendar MORE restrictive rather than less.
 */
export async function saveCalendarSettings(input: CalendarWrite): Promise<void> {
  const db = getSupabaseServiceClient() as unknown as Loose;
  const { tenantId, userId } = input;
  await assertSchemaFits(db, input);

  const rows = input.hours.map((entry) => ({
    tenant_id: tenantId,
    user_id: userId,
    weekday: entry.weekday,
    start_time: entry.startTime,
    end_time: entry.endTime,
    timezone: input.timezone,
  }));
  if (rows.length > 0) {
    const upserted = await db
      .from("tenant_agent_availability")
      .upsert(rows, { onConflict: "tenant_id,user_id,weekday,start_time" });
    if (upserted.error) throw new Error(`Could not save working hours: ${upserted.error.message}`);
  }

  // Now remove what is no longer in the week. Done as one delete of everything not kept rather than
  // row by row, so a member cannot end up with a partially rewritten week.
  const keep = new Set(rows.map((row) => `${row.weekday}|${row.start_time}`));
  const existing = await db
    .from("tenant_agent_availability")
    .select("id, weekday, start_time")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (existing.error) throw new Error(`Could not read working hours: ${existing.error.message}`);
  const stale = (existing.data ?? [])
    .filter((row) => !keep.has(`${Number(row.weekday ?? 0)}|${hhmm(row.start_time)}`))
    .map((row) => text(row.id));
  if (stale.length > 0) {
    const removed = await db.from("tenant_agent_availability").delete().in("id", stale);
    if (removed.error) throw new Error(`Could not remove old working hours: ${removed.error.message}`);
  }

  // Read before inserting. The delete below removes what the caller dropped, and the rows this save
  // is about to create would otherwise match that description — they are this member's and they are
  // not in the caller's id list, because they did not have ids when the caller sent them.
  const currentBlocks = await db
    .from("tenant_agent_blocks")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (currentBlocks.error) throw new Error(`Could not read blocked time: ${currentBlocks.error.message}`);

  // The recurrence column arrives with 20260924120000. Until then a write that does not use it
  // goes through in the old shape, and one that does is refused with a sentence, not a code.
  const legacyOk = fitsLegacySchema(input);
  const blockRow = (block: BlockedTime, withRepeats: boolean) => ({
    starts_at: block.startsAt,
    ends_at: block.endsAt,
    reason: block.reason?.trim() || null,
    ...(withRepeats ? { repeats: block.repeats } : {}),
  });
  const gap = (error: { message: string; code?: string } | null) => {
    if (isSchemaGap(error) && !legacyOk) throw new SchemaGapError();
    return isSchemaGap(error);
  };

  const newBlocks = input.blocks.filter((block) => !block.id);
  if (newBlocks.length > 0) {
    const insertBlocks = (withRepeats: boolean) =>
      db.from("tenant_agent_blocks").insert(
        newBlocks.map((block) => ({ tenant_id: tenantId, user_id: userId, ...blockRow(block, withRepeats) })),
      );
    let inserted = await insertBlocks(true);
    if (gap(inserted.error)) inserted = await insertBlocks(false);
    if (inserted.error) throw new Error(`Could not save blocked time: ${inserted.error.message}`);
  }

  // Edits to a block that already exists. The previous writer kept an existing block by id and
  // never wrote it, so changing a saved block's times on screen was silently discarded.
  const storedIds = new Set((currentBlocks.data ?? []).map((row) => text(row.id)));
  for (const block of input.blocks) {
    if (!block.id || !storedIds.has(block.id)) continue;
    const updateBlock = (withRepeats: boolean) =>
      db.from("tenant_agent_blocks").update(blockRow(block, withRepeats)).eq("tenant_id", tenantId).eq("id", block.id);
    let updated = await updateBlock(true);
    if (gap(updated.error)) updated = await updateBlock(false);
    if (updated.error) throw new Error(`Could not update blocked time: ${updated.error.message}`);
  }
  // The caller sends the whole desired list, so anything of this member's that did not come back
  // was removed on screen. Deleted after the inserts for the reason above: a block that survives a
  // failed save keeps the agent unbookable, and a block that vanishes does not.
  const keptBlocks = new Set(input.blocks.map((block) => block.id).filter(Boolean) as string[]);
  const removable = (currentBlocks.data ?? [])
    .map((row) => text(row.id))
    .filter((id) => id.length > 0 && !keptBlocks.has(id));
  if (removable.length > 0) {
    const removed = await db.from("tenant_agent_blocks").delete().in("id", removable);
    if (removed.error) throw new Error(`Could not remove blocked time: ${removed.error.message}`);
  }

  // Three shapes, newest first: with double-booking (20260924230200), with the two switches
  // (20260924120000), and the original. `assertSchemaFits` already refused any save that needs a
  // column the deployment lacks, so falling back here only ever drops a column left at its default.
  const writePolicy = (level: 2 | 1 | 0) =>
    db.from("tenant_agent_booking_policy").upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        appointment_minutes: input.policy.appointmentMinutes,
        buffer_minutes: input.policy.bufferMinutes,
        max_per_day: input.policy.maxPerDay,
        ...(level >= 1
          ? { allow_same_day: input.policy.allowSameDay, honour_linked_calendars: input.policy.honourLinkedCalendars }
          : {}),
        ...(level >= 2 ? { allow_double_booking: input.policy.allowDoubleBooking } : {}),
      },
      { onConflict: "tenant_id,user_id" },
    );
  let policy = await writePolicy(2);
  if (isSchemaGap(policy.error)) policy = await writePolicy(1);
  if (gap(policy.error)) policy = await writePolicy(0);
  if (policy.error) throw new Error(`Could not save the booking policy: ${policy.error.message}`);
}
