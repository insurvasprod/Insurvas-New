import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { COMPLAINT_CATEGORIES, COMPLAINT_CHANNELS, COMPLAINT_VIA } from "@/lib/compliance/complaints";
import { ComplaintError, deadlineSetup, listComplaints, openComplaint } from "@/lib/compliance/complaintStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";

/**
 * LA-6.4 (Notion sprint) · complaints: the list (days remaining first; search reads past responses
 * for precedent) and opening one. An unwanted-calls complaint puts the number on the internal
 * do-not-call list in the same transaction. Owner and producer only.
 */
const ROLES = ["owner", "producer"] as const;
const uuid = z.string().uuid();
const body = z.object({
  channel: z.enum(COMPLAINT_CHANNELS),
  regulator_state: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
  // A regulator's deadline counts from this day, so it cannot be a day that has not come yet (the
  // form sends noon UTC, which is still "today" anywhere in the US; a day's slack covers the rest).
  received_at: z.string().datetime({ offset: true }).refine((v) => Date.parse(v) <= Date.now() + 86_400_000, "The complaint can't have arrived in the future.").nullable().optional(),
  received_via: z.enum(COMPLAINT_VIA),
  complainant_name: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  policy_number: z.string().trim().max(120).nullable().optional(),
  about_agent_user_id: uuid.nullable().optional(),
  partner_id: uuid.nullable().optional(),
  category: z.enum(COMPLAINT_CATEGORIES),
  summary: z.string().trim().min(1).max(4000),
  owner_user_id: uuid.nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
}).strict();

const fail = (error: unknown) => {
  if (error instanceof ComplaintError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[complaints]", error);
  return NextResponse.json({ error: "The complaint could not be saved" }, { status: 500 });
};

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("tcpa_checker", ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Complaints");
  if (refused) return refused;
  const { tenantId, userId, role } = auth.context;
  try {
    const search = request.nextUrl.searchParams.get("q") ?? "";
    const [complaints, setup] = await Promise.all([listComplaints({ tenantId, userId, role }, { search }), deadlineSetup(tenantId)]);
    return NextResponse.json({ complaints, setup }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("tcpa_checker", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Complaints");
  if (refused) return refused;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the complaint and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId, role } = auth.context;
  try {
    const { id, evidence } = await openComplaint({ tenantId, userId, role }, {
      channel: b.channel, regulatorState: b.regulator_state ?? null, receivedAt: b.received_at ?? null, receivedVia: b.received_via,
      complainantName: b.complainant_name ?? null, phone: b.phone ?? null, policyNumber: b.policy_number ?? null, aboutAgentUserId: b.about_agent_user_id ?? null,
      partnerId: b.partner_id ?? null, category: b.category, summary: b.summary, ownerUserId: b.owner_user_id ?? null, notes: b.notes ?? null,
    });
    await audit({ actorType: "tenant", actorId: userId, action: "compliance.complaint_opened", targetType: "complaint", targetId: id, metadata: { tenantId, channel: b.channel, category: b.category, evidenceAttached: evidence.attached }, request });
    // The complaint is open either way; a report that could not be attached is said, not hidden.
    return NextResponse.json({ id, evidence_attached: evidence.attached, evidence_warning: evidence.attached ? null : evidence.reason }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
