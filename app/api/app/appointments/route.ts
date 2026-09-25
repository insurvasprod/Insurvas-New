import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { BOOKING_REFUSALS, bookAppointment, bookableContext, rebookAppointment, redactBlocksForSetter, rescheduleAppointment } from "@/lib/appointments/booking";
import { SCHEMA_GAP_MESSAGE, SchemaGapError } from "@/lib/appointments/schemaGap";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-2.11 / LA-2.12 · book and reschedule an appointment on the agent's calendar.
 *
 * **A setter is included deliberately.** LA-2.12's role table says a setter *can* "book appointments
 * into Ray's slots" and *cannot* "change availability or configuration" — so booking is open to
 * them and the availability routes are not. This is the single route where the setter is the primary
 * user rather than a role being kept out.
 *
 * Every rule lives in `book_appointment`. Nothing is re-checked here, because a second copy of the
 * window, availability, cap and overlap rules in TypeScript would be a second opinion that drifts —
 * and the overlap in particular *cannot* be decided outside the database without reintroducing the
 * race LA-2.11 exists to prevent.
 */
const BOOKING_ROLES = ["owner", "producer", "setter"] as const;

const bookSchema = z.object({
  lead_id: z.string().uuid(),
  agent_user_id: z.string().uuid(),
  starts_at_utc: z.string().datetime(),
  notes: z.string().trim().max(2000).nullable().optional(),
  duration_minutes: z.number().int().min(5).max(480).nullable().optional(),
}).strict();

const rescheduleSchema = z.object({
  appointment_id: z.string().uuid(),
  starts_at_utc: z.string().datetime(),
}).strict();

// Rebook a no-show (20260925704200): a new appointment, linked to the no-show, which stays one.
const rebookSchema = z.object({
  action: z.literal("rebook"),
  appointment_id: z.string().uuid(),
  starts_at_utc: z.string().datetime(),
  agent_user_id: z.string().uuid().nullable().optional(),
}).strict();

/** Maps a raised database code to its status and the sentence a setter can act on. */
function refusal(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  // The code is the leading token of the raised message, the same convention the close-out route
  // uses. Anything unrecognised is a 503 rather than a 400: an unknown failure is ours, not the
  // caller's, and telling a setter to fix their input would be wrong.
  const code = message.split(/[\s:]/)[0] ?? "";
  const known = BOOKING_REFUSALS[code];
  if (!known)
    return NextResponse.json(
      { error: "Booking is temporarily unavailable.", code: "booking_unavailable" },
      { status: 503 },
    );
  const [status, text] = known;
  return NextResponse.json({ error: text, code: code.toLowerCase() }, { status });
}

export async function GET() {
  const auth = await requireFeatureRole("outbound_dialing", BOOKING_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const context = await bookableContext(auth.context.tenantId);
    // Decided 2026-09-25: a setter sees blocked time as "Unavailable", never its reason. The time
    // itself stays in the payload, because the picker has to know it is not bookable.
    return NextResponse.json(auth.context.role === "setter" ? redactBlocksForSetter(context) : context, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the calendar" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", BOOKING_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = bookSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Enter valid appointment details" },
      { status: 400 },
    );

  try {
    const booked = await bookAppointment({
      tenantId: auth.context.tenantId,
      leadId: parsed.data.lead_id,
      agentUserId: parsed.data.agent_user_id,
      // Whoever is signed in booked it, never a value from the body. LA-2.12 measures setters on
      // booked-versus-showed, so a client that could name its own `booked_by` could attribute its
      // bookings to somebody else.
      bookedBy: auth.context.userId,
      startsAtUtc: parsed.data.starts_at_utc,
      notes: parsed.data.notes ?? null,
      durationMinutes: parsed.data.duration_minutes ?? null,
    });

    await audit({
      actorType: "tenant", actorId: auth.context.userId, action: "tenant.appointment_booked",
      targetType: "tenant_appointment", targetId: booked.appointmentId,
      metadata: {
        leadId: parsed.data.lead_id,
        agentUserId: parsed.data.agent_user_id,
        startsAtUtc: booked.startsAtUtc,
        durationMinutes: booked.durationMinutes,
        hasNotes: Boolean(parsed.data.notes?.trim()),
      },
      request,
    });
    return NextResponse.json({ appointment: booked }, { status: 201 });
  } catch (error) {
    return refusal(error);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", BOOKING_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null);

  if (body && typeof body === "object" && (body as { action?: unknown }).action === "rebook") {
    const rebook = rebookSchema.safeParse(body);
    if (!rebook.success)
      return NextResponse.json({ error: "Choose the no-show to rebook and a valid time" }, { status: 400 });
    try {
      const booked = await rebookAppointment({
        tenantId: auth.context.tenantId,
        appointmentId: rebook.data.appointment_id,
        // Whoever rebooks it is `booked_by` on the new appointment — never a value from the body.
        actorId: auth.context.userId,
        startsAtUtc: rebook.data.starts_at_utc,
        agentUserId: rebook.data.agent_user_id ?? null,
      });
      await audit({
        actorType: "tenant", actorId: auth.context.userId, action: "tenant.appointment_rebooked",
        targetType: "tenant_appointment", targetId: booked.appointmentId,
        metadata: { rebookedFrom: rebook.data.appointment_id, startsAtUtc: booked.startsAtUtc, agentUserId: rebook.data.agent_user_id ?? null },
        request,
      });
      return NextResponse.json({ appointment: booked }, { status: 201 });
    } catch (error) {
      if (error instanceof SchemaGapError) return NextResponse.json({ error: SCHEMA_GAP_MESSAGE, code: "schema_pending" }, { status: 503 });
      return refusal(error);
    }
  }

  const parsed = rescheduleSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "Choose a valid appointment and time" }, { status: 400 });

  try {
    await rescheduleAppointment({
      tenantId: auth.context.tenantId,
      appointmentId: parsed.data.appointment_id,
      actorId: auth.context.userId,
      startsAtUtc: parsed.data.starts_at_utc,
    });
    await audit({
      actorType: "tenant", actorId: auth.context.userId, action: "tenant.appointment_rescheduled",
      targetType: "tenant_appointment", targetId: parsed.data.appointment_id,
      metadata: { startsAtUtc: parsed.data.starts_at_utc }, request,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return refusal(error);
  }
}
