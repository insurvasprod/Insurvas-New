// Deactivating a coupon, fail closed (user decision f1, 2026-09-24).
//
// The Whop promo code is what a customer types at checkout, so it is switched off FIRST. Only when
// Whop has confirmed the code is inactive is the local row marked deactivated. The other order
// would leave a code our list calls "Deactivated" that Whop still honours.
//
// Pure orchestration with its dependencies passed in, so deactivate.test.mjs drives it with a fake
// provider and never touches the network or the database. lib/coupons/service.ts supplies the real
// Supabase reads and the real WhopProvider.

/** What Whop says a promo code is. `inactive` and `archived` both mean it can no longer be redeemed. */
const OFF_AT_WHOP = new Set(["inactive", "archived"]);

export type PromoCodeSwitch = {
  /** POST /promo_codes/{id}/deactivate. Returns the status Whop reports back, when it reports one. */
  deactivatePromoCode(promoCodeId: string): Promise<{ status: string | null }>;
  /** GET /promo_codes/{id}. Used to find out where a failed or timed-out deactivation left the code. */
  getPromoCodeStatus(promoCodeId: string): Promise<string | null>;
};

export type DeactivatableCoupon = {
  id: string;
  code: string;
  is_active: boolean;
  whop_promo_code_id: string | null;
};

export type DeactivateDeps = {
  loadCoupon(couponId: string): Promise<DeactivatableCoupon | null>;
  /** Null when the provider is not configured in this environment (no API key). */
  promoCodes(): PromoCodeSwitch | null;
  /** Sets is_active = false. False when the write did not land. */
  markInactive(couponId: string): Promise<boolean>;
};

export type DeactivateOutcome =
  | {
      kind: "deactivated";
      code: string;
      whopPromoCodeId: string | null;
      /** What Whop reported, or null when there was no promo code to switch off. */
      providerStatus: string | null;
      /** True when the deactivate call failed but a read showed the code was already off at Whop. */
      confirmedByRead: boolean;
    }
  | { kind: "already_inactive"; code: string }
  | { kind: "not_found" }
  | { kind: "provider_not_configured"; code: string }
  | { kind: "provider_refused"; code: string; message: string }
  | { kind: "local_write_failed"; code: string; whopPromoCodeId: string | null };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function deactivateCouponWith(deps: DeactivateDeps, couponId: string): Promise<DeactivateOutcome> {
  const coupon = await deps.loadCoupon(couponId);
  if (!coupon) return { kind: "not_found" };

  // Deactivating twice is the same request twice: say so rather than calling Whop again.
  if (!coupon.is_active) return { kind: "already_inactive", code: coupon.code };

  let providerStatus: string | null = null;
  let confirmedByRead = false;

  if (coupon.whop_promo_code_id) {
    const promoCodes = deps.promoCodes();
    if (!promoCodes) return { kind: "provider_not_configured", code: coupon.code };

    try {
      const result = await promoCodes.deactivatePromoCode(coupon.whop_promo_code_id);
      providerStatus = result.status;
      // A 200 that still says "active" is not a confirmation.
      if (providerStatus !== null && !OFF_AT_WHOP.has(providerStatus)) {
        return {
          kind: "provider_refused",
          code: coupon.code,
          message: `Whop answered but reports the code as "${providerStatus}"`,
        };
      }
    } catch (error) {
      // A refusal, a 5xx or a timeout. The call may still have landed (or the code may have been
      // switched off earlier, in Whop's dashboard), so ask before giving up.
      let status: string | null = null;
      try {
        status = await promoCodes.getPromoCodeStatus(coupon.whop_promo_code_id);
      } catch {
        status = null;
      }
      if (status === null || !OFF_AT_WHOP.has(status)) {
        return { kind: "provider_refused", code: coupon.code, message: describe(error) };
      }
      providerStatus = status;
      confirmedByRead = true;
    }
  }

  const written = await deps.markInactive(coupon.id);
  if (!written) return { kind: "local_write_failed", code: coupon.code, whopPromoCodeId: coupon.whop_promo_code_id };

  return {
    kind: "deactivated",
    code: coupon.code,
    whopPromoCodeId: coupon.whop_promo_code_id,
    providerStatus,
    confirmedByRead,
  };
}
