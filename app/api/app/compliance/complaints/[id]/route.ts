import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { COMPLAINT_OUTCOMES, COMPLAINT_STATUSES } from "@/lib/compliance/complaints";
import { checklistFor, ComplaintError, getComplaint, respondentFor, updateComplaint } from "@/lib/compliance/complaintStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";

/**
 * LA-6.4 (Notion sprint) · one complaint: read it (with the response checklist) and move its
 * workflow. The response text is the agent's own: nothing here writes or suggests it.
 */
const ROLES = ["owner", "producer"] as const;
const patch = z.object({
  status: z.enum(COMPLAINT_STATUSES).optional(),
  outcome: z.enum(COMPLAINT_OUTCOMES).nullable().optional(),
  owner_user_id: z.string().uuid().optional(),
  response_text: z.string().max(20000).nullable().optional(),
  responded_at: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  checklist: z.record(z.string(), z.boolean()).optional(),
  regulator_state: z.string().regex(/^[A-Z]{2}$/).optional(),
}).strict();

const fail = (error: unknown) => {
  if (error instanceof ComplaintError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[complaint]", error);
  return NextResponse.json({ error: "The complaint could not be saved" }, { status: 500 });
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("tcpa_checker", ROLES);
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Complaints");
  if (refused) return refused;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That complaint isn't here." }, { status: 404 });
  const { tenantId, userId, role } = auth.context;
  try {
    const complaint = await getComplaint({ tenantId, userId, role }, id);
    // A regulator complaint is answered under the business's legal name and NPN (LA-8.3).
    const [checklist, respondent] = await Promise.all([checklistFor(complaint.category), complaint.channel === "doi" ? respondentFor(tenantId, complaint.regulatorState) : null]);
    return NextResponse.json({ complaint, checklist, respondent }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("tcpa_checker", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Complaints");
  if (refused) return refused;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That complaint isn't here." }, { status: 404 });
  const parsed = patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the change and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId, role } = auth.context;
  try {
    const complaint = await updateComplaint({ tenantId, userId, role }, id, {
      status: b.status, outcome: b.outcome, ownerUserId: b.owner_user_id, responseText: b.response_text, respondedAt: b.responded_at, notes: b.notes, checklist: b.checklist, regulatorState: b.regulator_state,
    });
    await audit({ actorType: "tenant", actorId: userId, action: "compliance.complaint_updated", targetType: "complaint", targetId: id, metadata: { tenantId, fields: Object.keys(b) }, request });
    return NextResponse.json({ complaint });
  } catch (error) {
    return fail(error);
  }
}
