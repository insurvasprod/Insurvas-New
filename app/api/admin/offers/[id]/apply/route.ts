import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_COUPONS } from "@/lib/coupons/permissions";
import { applyFailureMessage } from "@/lib/coupons/service";
import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { applyOfferManually } from "@/lib/offers/service";

const schema = z.object({
  subscription_id: z.string().uuid(),
  confirmed: z.boolean().default(false),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_COUPONS);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a customer and offer" }, { status: 400 });

  const result = await applyOfferManually(
    id,
    parsed.data.subscription_id,
    auth.session.sub,
    parsed.data.confirmed,
  );
  if (result.status === "confirmation_required") {
    return NextResponse.json({ code: "confirmation_required", warning: result.warning }, { status: 409 });
  }
  if (result.status === "rejected") {
    return NextResponse.json({ error: applyFailureMessage(result.result) }, { status: 409 });
  }

  await audit({
    actorId: auth.session.sub,
    action: "offer.applied",
    targetType: "subscription",
    targetId: parsed.data.subscription_id,
    metadata: { offerId: id, application: "manual", confirmed: parsed.data.confirmed },
    request,
  });
  return NextResponse.json({ ok: true });
}
