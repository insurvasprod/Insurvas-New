import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { reviewActionSchema } from "@/lib/contacts/schemas";
import { ContactConflictError, SchemaNotReadyError, dismissReview, getReviewQueue } from "@/lib/contacts/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const CONTACT_ROLES = ["owner", "producer", "assistant"] as const;

/** The duplicate review queue, oldest first. `?index=` (0-based) picks the pair shown ("1 of N"). */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("duplicate_detection", CONTACT_ROLES);
  if (auth instanceof NextResponse) return auth;
  const index = Math.max(0, Math.floor(Number(request.nextUrl.searchParams.get("index") ?? 0) || 0));
  try { return NextResponse.json(await getReviewQueue(auth.context.tenantId, index)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the review queue" }, { status: 500 }); }
}

/** "Not the same person": closes a pair without merging. Merging is POST /api/app/contacts/merge. */
export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("duplicate_detection", CONTACT_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = reviewActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a match to dismiss" }, { status: 400 });
  try {
    const review = await dismissReview(auth.context.tenantId, auth.context.userId, parsed.data.review_id);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.contact_duplicate_dismissed", targetType: "contact_duplicate_review", targetId: review.id, metadata: { contactId: review.contact_id, candidateId: review.candidate_id, score: Number(review.score) }, request });
    return NextResponse.json({ reviewId: review.id });
  } catch (error) {
    if (error instanceof SchemaNotReadyError) return NextResponse.json({ error: error.message }, { status: 503 });
    const status = error instanceof ContactConflictError ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not dismiss this match" }, { status });
  }
}
