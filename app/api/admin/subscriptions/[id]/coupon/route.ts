import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_COUPONS } from "@/lib/coupons/permissions";
import { applyCoupon, applyFailureMessage, removeCoupon } from "@/lib/coupons/service";
import { audit } from "@/lib/audit/log";

const schema = z.object({ coupon_id: z.string().uuid() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_COUPONS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const result = await applyCoupon(id, parsed.data.coupon_id, auth.session.sub);

  if (result !== "ok") {
    // 409 rather than 400: the request was well formed, the coupon's state refused it.
    return NextResponse.json({ error: applyFailureMessage(result) }, { status: 409 });
  }

  await audit({
    actorId: auth.session.sub,
    action: "coupon.applied",
    targetType: "subscription",
    targetId: id,
    metadata: { couponId: parsed.data.coupon_id },
    request,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_COUPONS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const removed = await removeCoupon(id);
  if (!removed) return NextResponse.json({ error: "No coupon is applied" }, { status: 404 });

  await audit({
    actorId: auth.session.sub,
    action: "coupon.removed",
    targetType: "subscription",
    targetId: id,
    request,
  });

  return NextResponse.json({ ok: true });
}
