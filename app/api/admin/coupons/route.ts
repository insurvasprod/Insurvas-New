import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_COUPONS } from "@/lib/coupons/permissions";
import { fetchCoupons } from "@/lib/coupons/queries";
import { createCoupon } from "@/lib/coupons/service";
import { parseDollarsToCents } from "@/lib/money";
import { audit } from "@/lib/audit/log";

export async function GET() {
  const auth = await requireAdminRole(CAN_MANAGE_COUPONS);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({ coupons: await fetchCoupons() });
}

const schema = z
  .object({
    // Uppercased so WELCOME50 and welcome50 cannot both exist and confuse a customer.
    code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only"),
    discount_type: z.enum(["percent", "fixed"]),
    percent_off: z.number().int().min(1).max(100).nullable().optional(),
    /** Dollars as a string, so no float touches the amount. */
    amount_off: z.string().trim().nullable().optional(),
    duration: z.enum(["once", "n_periods", "forever"]),
    duration_periods: z.number().int().min(1).max(60).nullable().optional(),
    billing_cycle: z.enum(["monthly", "quarterly", "yearly"]),
    max_redemptions: z.number().int().min(1).nullable().optional(),
    expires_at: z.string().datetime().nullable().optional(),
  })
  .refine((v) => (v.duration === "n_periods" ? Boolean(v.duration_periods) : true), {
    message: "Give the number of billing periods",
  });

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_COUPONS);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const input = parsed.data;
  let amountOffCents: number | null = null;

  if (input.discount_type === "fixed") {
    amountOffCents = input.amount_off ? parseDollarsToCents(input.amount_off) : null;
    if (amountOffCents === null || amountOffCents <= 0) {
      return NextResponse.json({ error: "Enter an amount like 25.00" }, { status: 400 });
    }
  } else if (!input.percent_off) {
    return NextResponse.json({ error: "Enter a percentage between 1 and 100" }, { status: 400 });
  }

  try {
    const created = await createCoupon({
      code: input.code.toUpperCase(),
      discountType: input.discount_type,
      percentOff: input.discount_type === "percent" ? (input.percent_off ?? null) : null,
      amountOffCents,
      duration: input.duration,
      durationPeriods: input.duration === "n_periods" ? (input.duration_periods ?? null) : null,
      billingCycle: input.billing_cycle,
      maxRedemptions: input.max_redemptions ?? null,
      expiresAt: input.expires_at ?? null,
      createdBy: auth.session.sub,
    });

    await audit({
      actorId: auth.session.sub,
      action: "coupon.created",
      targetType: "coupon",
      targetId: created.id,
      metadata: {
        code: input.code.toUpperCase(),
        discountType: input.discount_type,
        percentOff: input.percent_off ?? null,
        amountOffCents,
        duration: input.duration,
        durationPeriods: input.duration_periods ?? null,
        billingCycle: input.billing_cycle,
        whopPromoCodeId: created.whopPromoCodeId,
      },
      request,
    });

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the coupon";
    // A duplicate code is the common case and deserves its own message.
    if (message.includes("duplicate key") || message.includes("coupons_code_key")) {
      return NextResponse.json({ error: "A coupon with that code already exists" }, { status: 409 });
    }
    console.error("[coupons] create failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
