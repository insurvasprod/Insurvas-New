import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { readReviews, recordReview, setSampleRate } from "@/lib/agency/reviewStore";
import { REVIEW_ERROR_TYPES } from "@/lib/agency/reviewCore";
import { refusalResponse } from "@/lib/agency/rpc";
import { NO_STORE } from "@/lib/agency/http";
import { audit } from "@/lib/audit/log";

/**
 * AG-1.11 · Application Review. GET: the sampled queue and the reviewed (scoped by AG-0.4 — a producer sees his
 * own reviews, a manager his reports'). POST: a reviewer's outcome (owner, admin or a manager — not a producer
 * reviewing himself). PUT: a producer's sample rate (owner, admin).
 */
export async function GET() {
  const auth = await requireFeatureRole("team_qa", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ reviews: await readReviews(auth.context), canReview: auth.context.role === "owner" || auth.context.memberRole === "manager" }, { headers: NO_STORE });
  } catch (error) {
    return refusalResponse(error);
  }
}

const recordSchema = z.object({
  reviewId: z.string().uuid(),
  status: z.enum(["passed", "failed", "fix_requested"]),
  errorTypes: z.array(z.enum(REVIEW_ERROR_TYPES)).max(8).default([]),
  note: z.string().trim().max(1000).nullable().optional(),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("team_qa", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  if (auth.context.role !== "owner" && auth.context.memberRole !== "manager") return NextResponse.json({ error: "The owner, an admin or a manager reviews applications.", code: "role_not_allowed" }, { status: 403 });
  const parsed = recordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the review" }, { status: 400 });
  if (parsed.data.status !== "passed" && (!parsed.data.errorTypes.length || !parsed.data.note)) {
    return NextResponse.json({ error: "A fail or a fix needs an error type and a note for the producer." }, { status: 400 });
  }
  try {
    await recordReview({ tenantId: auth.context.tenantId, reviewId: parsed.data.reviewId, status: parsed.data.status, errorTypes: parsed.data.errorTypes, note: parsed.data.note ?? null, actorId: auth.context.userId });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "agency.application_reviewed", targetType: "application_review", targetId: parsed.data.reviewId, metadata: { tenantId: auth.context.tenantId, status: parsed.data.status, errorTypes: parsed.data.errorTypes }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return refusalResponse(error);
  }
}

const rateSchema = z.object({ producerUserId: z.string().uuid(), samplePercent: z.number().int().min(0).max(100) }).strict();

export async function PUT(request: NextRequest) {
  const auth = await requireFeatureRole("team_qa", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = rateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a sample rate from 0 to 100%" }, { status: 400 });
  await setSampleRate(auth.context.tenantId, parsed.data.producerUserId, parsed.data.samplePercent * 100, auth.context.userId);
  return NextResponse.json({ ok: true });
}
