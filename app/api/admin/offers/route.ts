import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_COUPONS } from "@/lib/coupons/permissions";
import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { fetchOffers } from "@/lib/offers/queries";
import { createOffer } from "@/lib/offers/service";
import { offerInputSchema } from "@/lib/offers/schemas";

export async function GET() {
  const auth = await requireAdminRole(CAN_MANAGE_COUPONS);
  if (auth instanceof NextResponse) return auth;

  try {
    return NextResponse.json({ offers: await fetchOffers() });
  } catch {
    return NextResponse.json({ error: "Could not load offers" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_COUPONS);
  if (auth instanceof NextResponse) return auth;

  const parsed = offerInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid offer" }, { status: 400 });
  }

  try {
    const offer = await createOffer({ ...parsed.data, createdBy: auth.session.sub });
    await audit({
      actorId: auth.session.sub,
      action: "offer.created",
      targetType: "offer",
      targetId: offer.id,
      metadata: {
        name: offer.name,
        couponId: offer.coupon_id,
        autoApply: offer.auto_apply,
        startsAt: offer.starts_at,
        endsAt: offer.ends_at,
        maxRedemptions: offer.max_redemptions,
        eligiblePlanTypes: offer.eligible_plan_types,
        eligiblePlanIds: offer.eligible_plan_ids,
        eligibleCycles: offer.eligible_cycles,
        newCustomersOnly: offer.new_customers_only,
        existingCustomersOnly: offer.existing_customers_only,
      },
      request,
    });
    return NextResponse.json({ offer }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create offer";
    console.error("[offers] create failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
