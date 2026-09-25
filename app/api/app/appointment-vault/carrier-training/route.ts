import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { carrierTrainingIdSchema, carrierTrainingSchema } from "@/lib/appointments/schemas";
import { addCarrierTraining, completeCarrierTraining, removeCarrierTraining, TrainingNotFoundError } from "@/lib/appointments/service";
import { SchemaPendingError, schemaPendingBody } from "@/lib/appointments/pendingSchema";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * /app/appointments · carrier-specific trainings (migration 20260924310100).
 *
 * The same gate as the rest of the vault's writes: an owner on a plan with full access. Producers
 * read the trainings through GET /api/app/appointment-vault.
 */
function failure(error: unknown, fallback: string) {
  if (error instanceof SchemaPendingError) return NextResponse.json(schemaPendingBody(), { status: 503 });
  if (error instanceof TrainingNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("appointment_vault", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = carrierTrainingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid training details" }, { status: 400 });
  try {
    if (parsed.data.action === "add") {
      const row = await addCarrierTraining(auth.context.tenantId, auth.context.userId, parsed.data);
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.carrier_training_added", targetType: "carrier_training", targetId: row.id, metadata: { carrierId: row.carrier_id, title: row.title, dueOn: row.due_on }, request });
      return NextResponse.json({ training: row }, { status: 201 });
    }
    const row = await completeCarrierTraining(auth.context.tenantId, auth.context.userId, parsed.data.id, parsed.data.completed_on);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.carrier_training_completed", targetType: "carrier_training", targetId: row.id, metadata: { carrierId: row.carrier_id, completedOn: row.completed_on }, request });
    return NextResponse.json({ training: row });
  } catch (error) {
    return failure(error, "Could not save the training");
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeatureRole("appointment_vault", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const id = carrierTrainingIdSchema.safeParse(request.nextUrl.searchParams.get("id") ?? "");
  if (!id.success) return NextResponse.json({ error: id.error.issues[0]?.message ?? "Choose a training" }, { status: 400 });
  try {
    const row = await removeCarrierTraining(auth.context.tenantId, id.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.carrier_training_removed", targetType: "carrier_training", targetId: row.id, metadata: { carrierId: row.carrier_id, title: row.title }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error, "Could not remove the training");
  }
}
