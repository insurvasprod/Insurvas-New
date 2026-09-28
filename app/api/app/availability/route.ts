import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { getCalendarSettings, saveAgencyBookingSettings, saveCalendarSettings } from "@/lib/appointments/availability";
import { BLOCK_REPEATS } from "@/lib/appointments/calendarMath";
import { SchemaGapError } from "@/lib/appointments/schemaGap";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-2.11 · the working hours, blocked time and booking policy every appointment rule reads.
 *
 * Kept off `/api/app/appointments` deliberately. LA-2.12's role table has "Book appointments into
 * Ray's slots" on the Can side and "Change availability or configuration" on the Cannot side, and
 * one route cannot hold both — which is also why `permissions.ts` splits `appointments.book` from
 * `calendar.manage`. A setter reaching this route gets a 403 from the role list below.
 */
const CALENDAR_ROLES = ["owner", "producer", "assistant"] as const;

const hourSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});

const saveSchema = z.object({
  user_id: z.string().uuid(),
  timezone: z.string().trim().min(1).max(64),
  hours: z.array(hourSchema).max(28),
  blocks: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        startsAt: z.string().datetime({ offset: true }),
        endsAt: z.string().datetime({ offset: true }),
        reason: z.string().trim().max(120).nullable().optional(),
        // Optional so an older client that never sent it still saves one-off blocks.
        repeats: z.enum(BLOCK_REPEATS).optional(),
      }),
    )
    .max(100),
  policy: z.object({
    appointmentMinutes: z.number().int().min(5).max(480),
    bufferMinutes: z.number().int().min(0).max(120),
    maxPerDay: z.number().int().min(1).max(50),
    allowSameDay: z.boolean().optional(),
    honourLinkedCalendars: z.boolean().optional(),
    allowDoubleBooking: z.boolean().optional(),
  }),
  // The agency-wide settings. Owners only; null clears a field, omitted means unchanged.
  //   maxPerDay (20260924230200): the agency's daily appointment cap.
  //   callbackReminderMinutes (20260925711600): the callback reminder lead time, 5–1440 minutes,
  //   null = the platform default (LA-1.22 / LA-2.10 "reminder at a configurable lead time").
  agency: z.object({
    maxPerDay: z.number().int().min(1).max(1000).nullable().optional(),
    callbackReminderMinutes: z.number().int().min(5).max(1440).nullable().optional(),
  }).strict().optional(),
}).strict();

export async function GET() {
  const auth = await requireFeatureRole("outbound_dialing", CALENDAR_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const { members, schema, agency } = await getCalendarSettings(auth.context.tenantId);
    return NextResponse.json(
      // `canEditOthers` travels with the payload so the screen decides what to OFFER and the route
      // stays the enforcement. A producer shown another member's editable week would get a 403 from
      // a control that looked available.
      { members, schema, agency, canEditOthers: auth.context.role === "owner", selfUserId: auth.context.userId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the calendar settings" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", CALENDAR_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  if (!hasTenantPermission(auth.context.role, "calendar.manage"))
    return NextResponse.json({ error: "Your role cannot change the calendar", code: "role_not_allowed" }, { status: 403 });

  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Enter valid calendar settings" },
      { status: 400 },
    );

  // An owner configures the team's calendars; anyone else configures their own. Rewriting a
  // colleague's working hours changes when leads can be booked with them, which is the owner's
  // decision to make and nobody else's.
  if (auth.context.role !== "owner" && parsed.data.user_id !== auth.context.userId)
    return NextResponse.json(
      { error: "You can only change your own working hours. Ask an owner to change somebody else's.", code: "not_your_calendar" },
      { status: 403 },
    );

  for (const entry of parsed.data.hours) {
    if (entry.startTime >= entry.endTime)
      return NextResponse.json(
        { error: "A working day has to end after it starts.", code: "invalid_hours" },
        { status: 400 },
      );
  }
  for (const block of parsed.data.blocks) {
    if (Date.parse(block.startsAt) >= Date.parse(block.endsAt))
      return NextResponse.json(
        { error: "Blocked time has to end after it starts.", code: "invalid_block" },
        { status: 400 },
      );
    // A repeat longer than its own period would overlap its next occurrence, which is a block
    // covering all time wearing a schedule.
    const hours = (Date.parse(block.endsAt) - Date.parse(block.startsAt)) / 3_600_000;
    const period = { none: Infinity, daily: 24, weekdays: 24, weekly: 168, yearly: 8760 }[block.repeats ?? "none"];
    if (hours >= period)
      return NextResponse.json(
        { error: "A repeating block has to be shorter than the gap between its repeats.", code: "invalid_repeat" },
        { status: 400 },
      );
  }
  // Two rows for the same weekday and start time are the same row: the table's unique key says so,
  // and an upsert would silently keep one. Refused here so the screen can say which day.
  const seen = new Set<string>();
  for (const entry of parsed.data.hours) {
    const key = `${entry.weekday}|${entry.startTime}`;
    if (seen.has(key))
      return NextResponse.json(
        { error: "Two working blocks start at the same time on the same day. Merge them.", code: "duplicate_hours" },
        { status: 400 },
      );
    seen.add(key);
  }

  // The agency's cap is the agency's, so only an owner changes it — whoever's week is being saved.
  if (parsed.data.agency && auth.context.role !== "owner")
    return NextResponse.json(
      { error: "Only an owner can change the agency's daily limit or callback reminder time.", code: "agency_owner_only" },
      { status: 403 },
    );

  try {
    if (parsed.data.agency) {
      await saveAgencyBookingSettings({
        tenantId: auth.context.tenantId,
        userId: auth.context.userId,
        maxPerDay: parsed.data.agency.maxPerDay,
        callbackReminderMinutes: parsed.data.agency.callbackReminderMinutes,
      });
    }
    await saveCalendarSettings({
      tenantId: auth.context.tenantId,
      userId: parsed.data.user_id,
      timezone: parsed.data.timezone,
      hours: parsed.data.hours,
      blocks: parsed.data.blocks.map((block) => ({ ...block, reason: block.reason ?? null, repeats: block.repeats ?? "none" })),
      policy: {
        ...parsed.data.policy,
        allowSameDay: parsed.data.policy.allowSameDay ?? true,
        honourLinkedCalendars: parsed.data.policy.honourLinkedCalendars ?? true,
        allowDoubleBooking: parsed.data.policy.allowDoubleBooking ?? false,
      },
    });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.calendar_updated",
      targetType: "tenant_agent_availability",
      targetId: parsed.data.user_id,
      metadata: {
        timezone: parsed.data.timezone,
        workingBlocks: parsed.data.hours.length,
        blockedPeriods: parsed.data.blocks.length,
        maxPerDay: parsed.data.policy.maxPerDay,
        bufferMinutes: parsed.data.policy.bufferMinutes,
        allowSameDay: parsed.data.policy.allowSameDay ?? true,
        allowDoubleBooking: parsed.data.policy.allowDoubleBooking ?? false,
        agencyMaxPerDay: parsed.data.agency ? parsed.data.agency.maxPerDay : undefined,
        agencyCallbackReminderMinutes: parsed.data.agency ? parsed.data.agency.callbackReminderMinutes : undefined,
        repeatingBlocks: parsed.data.blocks.filter((block) => (block.repeats ?? "none") !== "none").length,
      },
      request,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SchemaGapError)
      return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the calendar settings" },
      { status: 500 },
    );
  }
}
