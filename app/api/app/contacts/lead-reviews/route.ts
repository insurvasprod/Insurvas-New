import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { getLeadDuplicateQueue, LeadDuplicateConflictError, LeadDuplicatesNotReadyError, resolveLeadDuplicate } from "@/lib/leadDuplicates/service";
import { leadDuplicateDecisionError, type LeadDuplicateDecision } from "@/lib/leadDuplicates/types";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";

const CONTACT_ROLES = ["owner", "producer", "assistant"] as const;

/** Same-phone leads waiting on Clean, oldest first. `?index=` (0-based) picks the one shown. */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("duplicate_detection", CONTACT_ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Duplicate review");
  if (refused) return refused;
  const index = Math.max(0, Math.floor(Number(request.nextUrl.searchParams.get("index") ?? 0) || 0));
  try { return NextResponse.json(await getLeadDuplicateQueue(auth.context.tenantId, index), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load same-phone leads" }, { status: 500 }); }
}

/** { review_id, decision: "same_person" | "separate" }. "separate" on a re-imported row adds it as a lead of its own. */
export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("duplicate_detection", CONTACT_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Duplicate review");
  if (refused) return refused;
  const body = await request.json().catch(() => null) as { review_id?: unknown; decision?: unknown } | null;
  const reviewId = typeof body?.review_id === "string" && /^[0-9a-f-]{36}$/i.test(body.review_id) ? body.review_id : null;
  if (!reviewId) return NextResponse.json({ error: "Choose a question to answer" }, { status: 400 });
  const invalid = leadDuplicateDecisionError(body?.decision);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const decision = body?.decision as LeadDuplicateDecision;
  try {
    const result = await resolveLeadDuplicate(auth.context.tenantId, auth.context.userId, reviewId, decision);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_duplicate_resolved", targetType: "lead_duplicate_review", targetId: reviewId, metadata: { decision, createdLeadId: result.createdLeadId }, request });
    return NextResponse.json({ reviewId, createdLeadId: result.createdLeadId });
  } catch (error) {
    if (error instanceof LeadDuplicatesNotReadyError) return NextResponse.json({ error: error.message }, { status: 503 });
    const status = error instanceof LeadDuplicateConflictError ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save this answer" }, { status });
  }
}
