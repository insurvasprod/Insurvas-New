import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_COUPONS } from "@/lib/coupons/permissions";
import { deactivateCoupon } from "@/lib/coupons/service";
import { audit } from "@/lib/audit/log";

const idSchema = z.string().uuid();

/**
 * Deactivates a coupon (user decision f1). Whop's promo code is switched off first; only when Whop
 * confirms is our row marked inactive. If Whop refuses, times out or is not configured, nothing is
 * changed here and the answer says so.
 *
 * Retry-safe without an idempotency ledger: the operation sets a state rather than adding to one,
 * a second call on a deactivated coupon returns 200 without calling Whop, and the Whop call carries
 * the same Idempotency-Key on every retry. Each Whop call is recorded in provider_calls by WhopClient.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_COUPONS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Coupon not found" }, { status: 404 });

  let outcome;
  try {
    outcome = await deactivateCoupon(id);
  } catch (error) {
    console.error("[coupons] deactivate failed before reaching Whop:", error);
    return NextResponse.json({ error: "Could not read the coupon. Nothing was changed." }, { status: 500 });
  }

  switch (outcome.kind) {
    case "not_found":
      return NextResponse.json({ error: "Coupon not found" }, { status: 404 });

    case "already_inactive":
      return NextResponse.json({ ok: true, alreadyInactive: true, message: `${outcome.code} was already deactivated` });

    case "deactivated":
      await audit({
        actorId: auth.session.sub,
        action: "coupon.deactivated",
        targetType: "coupon",
        targetId: id,
        metadata: {
          code: outcome.code,
          whopPromoCodeId: outcome.whopPromoCodeId,
          providerStatus: outcome.providerStatus,
          confirmedByRead: outcome.confirmedByRead,
        },
        request,
      });
      return NextResponse.json({
        ok: true,
        message: outcome.whopPromoCodeId
          ? `${outcome.code} deactivated. Whop no longer accepts it at checkout.`
          : `${outcome.code} deactivated. It had no Whop promo code, so only this record changed.`,
      });

    case "provider_not_configured":
      await audit({
        actorId: auth.session.sub,
        action: "coupon.deactivation_failed",
        targetType: "coupon",
        targetId: id,
        reason: "Whop is not configured in this environment",
        metadata: { code: outcome.code, stage: "provider", whopDeactivated: false },
        request,
      });
      return NextResponse.json(
        { error: "Whop is not configured here, so the code cannot be switched off at Whop. Nothing was changed." },
        { status: 503 },
      );

    case "provider_refused":
      await audit({
        actorId: auth.session.sub,
        action: "coupon.deactivation_failed",
        targetType: "coupon",
        targetId: id,
        reason: outcome.message,
        metadata: { code: outcome.code, stage: "provider", whopDeactivated: false },
        request,
      });
      return NextResponse.json(
        { error: `Whop did not confirm that ${outcome.code} is switched off, so nothing was changed. Try again.` },
        { status: 502 },
      );

    case "local_write_failed":
      // The safe half landed: Whop no longer honours the code. Our row still says active, and a
      // retry will finish it (Whop's answer is re-read, not re-guessed).
      await audit({
        actorId: auth.session.sub,
        action: "coupon.deactivation_failed",
        targetType: "coupon",
        targetId: id,
        reason: outcome.whopPromoCodeId
          ? "Switched off at Whop but the local record could not be updated"
          : "The local record could not be updated",
        metadata: { code: outcome.code, stage: "local", whopDeactivated: outcome.whopPromoCodeId !== null },
        request,
      });
      return NextResponse.json(
        {
          error: outcome.whopPromoCodeId
            ? `${outcome.code} is off at Whop, but this record could not be updated. Try again to finish.`
            : `${outcome.code} could not be updated. Nothing was changed.`,
        },
        { status: 500 },
      );
  }
}
