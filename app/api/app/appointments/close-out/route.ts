import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { appointmentFacts } from "@/lib/appointments/booking";
import { listCloseOutAppointments, markCloseOutOutcome } from "@/lib/appointments/closeOut";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const OUTCOME_ROLES = ["owner", "producer"] as const;
// LA-2.11-5 (20260929202000): booked -> confirmed is PATCH /api/app/appointments. 'rescheduled' is not
// an outcome — a reschedule books its new slot through that route in the same statement.
const bodySchema = z.object({ appointment_id: z.string().uuid(), outcome: z.enum(["showed", "no_show", "cancelled"]) }).strict();

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "The appointment close-out service is unavailable.";
  const known = new Map<string, readonly [number, string]>([
    ["APPOINTMENT_NOT_ACTIVE", [409, "appointment_not_active"]],
    ["APPOINTMENT_NOT_YET_HELD", [409, "appointment_not_yet_held"]],
    ["APPOINTMENT_OUTCOME_UNKNOWN", [400, "invalid_outcome"]],
    ["ACTOR_NOT_A_MEMBER", [403, "actor_not_member"]],
    ["SETTER_MAY_NOT_RECORD_OUTCOMES", [403, "role_not_allowed"]],
  ] as const);
  const code = message.split(" ")[0] ?? "close_out_unavailable";
  const [status, safeCode] = known.get(code) ?? [503, "close_out_unavailable"];
  const text = status === 503
    ? "Appointment close-out is temporarily unavailable."
    : safeCode === "appointment_not_yet_held"
      ? "This appointment has not happened yet, so nobody can have shown up or missed it. Close it out after it starts."
      : "That appointment cannot be closed out in its current state.";
  return NextResponse.json({ error: text, code: safeCode }, { status });
}

export async function GET() {
  const auth = await requireFeatureRole("outbound_dialing", OUTCOME_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ appointments: await listCloseOutAppointments(auth.context.tenantId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", OUTCOME_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid appointment outcome." }, { status: 400 });
  try {
    // LA-2.11-5: nobody shows up, or fails to, for a call that has not happened. The database refuses
    // it too (APPOINTMENT_NOT_YET_HELD, 20260929202000); this answers before that is applied.
    if (parsed.data.outcome === "showed" || parsed.data.outcome === "no_show") {
      const facts = await appointmentFacts(auth.context.tenantId, parsed.data.appointment_id);
      if (!facts) return failure(new Error("APPOINTMENT_NOT_ACTIVE"));
      if (Date.parse(facts.startsAtUtc) > Date.now()) return failure(new Error("APPOINTMENT_NOT_YET_HELD"));
    }
    await markCloseOutOutcome({ tenantId: auth.context.tenantId, appointmentId: parsed.data.appointment_id, actorId: auth.context.userId, outcome: parsed.data.outcome });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.appointment_outcome_recorded", targetType: "tenant_appointment", targetId: parsed.data.appointment_id, metadata: { outcome: parsed.data.outcome }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
