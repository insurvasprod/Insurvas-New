import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { DELETION_VIA } from "@/lib/compliance/dataSubject";
import { createDeletionRequest, DeletionError, listDeletionRequests } from "@/lib/compliance/dataSubjectStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";

/**
 * LA-6.5 (Notion sprint) · consumer deletion requests: the list, and logging a new one (it arrives
 * with a legal clock). Owner and producer may log; verifying and performing are the owner's.
 */
const ROLES = ["owner", "producer"] as const;
const body = z.object({
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(254).nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
  requester_name: z.string().trim().max(200).nullable().optional(),
  // The channel it came from (caller ID or the sender's address): identity is matched on this.
  requester_contact: z.string().trim().max(254).nullable().optional(),
  received_via: z.enum(DELETION_VIA),
  received_at: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

const fail = (error: unknown) => {
  if (error instanceof DeletionError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[deletions]", error);
  return NextResponse.json({ error: "The request could not be saved" }, { status: 500 });
};

export async function GET() {
  const auth = await requireFeatureRole("tcpa_checker", ROLES);
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Deletion requests");
  if (refused) return refused;
  const { tenantId, userId, role } = auth.context;
  try {
    return NextResponse.json({ requests: await listDeletionRequests({ tenantId, userId, role }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("tcpa_checker", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Deletion requests");
  if (refused) return refused;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId, role } = auth.context;
  try {
    const id = await createDeletionRequest({ tenantId, userId, role }, { phone: b.phone ?? null, email: b.email ?? null, contactId: b.contact_id ?? null, requesterName: b.requester_name ?? null, receivedVia: b.received_via, receivedAt: b.received_at ?? null, requesterContact: b.requester_contact ?? null });
    await audit({ actorType: "tenant", actorId: userId, action: "compliance.deletion_requested", targetType: "deletion_request", targetId: id, metadata: { tenantId, via: b.received_via }, request });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
