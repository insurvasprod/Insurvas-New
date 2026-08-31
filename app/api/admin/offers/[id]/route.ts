import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_COUPONS } from "@/lib/coupons/permissions";
import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { fetchOffer } from "@/lib/offers/queries";
import { updateOffer } from "@/lib/offers/service";
import { offerUpdateSchema } from "@/lib/offers/schemas";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_COUPONS);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const offer = await fetchOffer(id);
  return offer ? NextResponse.json({ offer }) : NextResponse.json({ error: "Offer not found" }, { status: 404 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_COUPONS);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = offerUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid offer update" }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Provide at least one field to update" }, { status: 400 });
  }

  try {
    const offer = await updateOffer(id, parsed.data);
    await audit({
      actorId: auth.session.sub,
      action: "offer.updated",
      targetType: "offer",
      targetId: id,
      metadata: { changedFields: Object.keys(parsed.data) },
      request,
    });
    return NextResponse.json({ offer });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update offer";
    const status = message === "Offer not found" ? 404 : message.includes("cannot be edited") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
