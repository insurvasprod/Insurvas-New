import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { VERIFICATION_METHODS } from "@/lib/compliance/dataSubject";
import {
  cancelDeletionRequest,
  DeletionError,
  eventsFor,
  getDeletionRequest,
  performDeletion,
  previewDeletion,
  rejectDeletionRequest,
  verifyDeletionRequest,
} from "@/lib/compliance/dataSubjectStore";
import { loadComplianceSettings } from "@/lib/compliance/settingsStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";

/**
 * LA-6.5 (Notion sprint) · one deletion request: read it (with its audit trail and, before the
 * purge, what would be found), and move it — verify, reject, cancel, perform. Moving it is the
 * tenant admin's. Performing deletes data for good: only after verification and the hold.
 */
const action = z.discriminatedUnion("action", [
  // contact: the number they called from / the address they wrote from, when not recorded at intake.
  z.object({ action: z.literal("verify"), method: z.enum(VERIFICATION_METHODS), note: z.string().max(2000).nullable().optional(), contact: z.string().trim().max(254).nullable().optional() }).strict(),
  z.object({ action: z.literal("reject"), reason: z.string().max(2000) }).strict(),
  z.object({ action: z.literal("cancel"), reason: z.string().max(2000).nullable().optional() }).strict(),
  z.object({ action: z.literal("perform"), confirm: z.literal(true) }).strict(),
]);

const fail = (error: unknown) => {
  if (error instanceof DeletionError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[deletion]", error);
  return NextResponse.json({ error: "The request could not be updated" }, { status: 500 });
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("tcpa_checker", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Deletion requests");
  if (refused) return refused;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That request isn't here." }, { status: 404 });
  const { tenantId, userId, role } = auth.context;
  const viewer = { tenantId, userId, role };
  try {
    const request = await getDeletionRequest(viewer, id);
    const performers = (await loadComplianceSettings(tenantId)).deletion.performerRoles;
    const preview = ["received", "verifying", "scheduled"].includes(request.status) && performers.includes(role) ? await previewDeletion(viewer, id) : null;
    return NextResponse.json({ request, events: await eventsFor(viewer, id), preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("tcpa_checker", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Deletion requests");
  if (refused) return refused;
  // Who may move a request is the agency's setting (LA-6.8): the tenant admin always; a producer only if allowed.
  const performers = (await loadComplianceSettings(auth.context.tenantId)).deletion.performerRoles;
  if (!performers.includes(auth.context.role)) return NextResponse.json({ error: "Only the agency owner can verify or perform a deletion." }, { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That request isn't here." }, { status: 404 });
  const parsed = action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose what to do." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId, role } = auth.context;
  const viewer = { tenantId, userId, role };
  try {
    if (b.action === "verify") await verifyDeletionRequest(viewer, id, b.method, b.note ?? null, b.contact ?? null);
    else if (b.action === "reject") await rejectDeletionRequest(viewer, id, b.reason);
    else if (b.action === "cancel") await cancelDeletionRequest(viewer, id, b.reason ?? null);
    else await performDeletion(viewer, id);
    await audit({ actorType: "tenant", actorId: userId, action: "compliance.deletion_updated", targetType: "deletion_request", targetId: id, metadata: { tenantId, step: b.action }, request });
    return NextResponse.json({ request: await getDeletionRequest(viewer, id), events: await eventsFor(viewer, id) });
  } catch (error) {
    return fail(error);
  }
}
