import "server-only";

// A checkout paid for entirely by a coupon (100% off, forever: lib/coupons/discount.ts isFullComp).
//
// It takes the no-payment path:
// - The plan starts through completeWithoutPayment, the same completeCheckout a paid checkout ends in.
// - The tenant is put on manual billing.
// - The payment provider is never called, so there is no card page and no Whop membership. Nothing can
//   ever be charged, now or at renewal.
// - The tenant is recorded as comped (tenant_comps, the admin console's "Comped — no charge"). That is
//   also what makes the period billing run raise no usage or add-on invoice for it (lib/billing/gather.ts).

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { BillingCycle } from "@/lib/money";
import { completeWithoutPayment } from "./noPayment";

export async function redeemFullComp(
  tenantId: string,
  plan: { id: string; name: string },
  billingCycle: BillingCycle,
  coupon: { id: string; code: string },
): Promise<{ subscriptionId: string; created: boolean }> {
  const supabase = getSupabaseServiceClient();
  const started = await completeWithoutPayment(tenantId, plan, billingCycle);

  // tenant_comps is written only through its functions (20261015530000). This one
  // (20261022400000) checks the coupon and the tenant's billing again, and adds nothing to a tenant
  // already comped.
  const { error } = await (supabase as unknown as { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }> })
    .rpc("record_coupon_comp", { p_tenant_id: tenantId, p_coupon_id: coupon.id });
  // The plan is already on, manual billing is already set, and no provider was called, so nothing can be
  // charged either way. Loud, because without the comp the period run could still raise an
  // unpaid invoice, and the admin console's comped list would miss this tenant.
  if (error) console.error(`[checkout] comp for ${tenantId} (coupon ${coupon.code}) not recorded: ${error.message}`);

  // Counted once, by the call that started the subscription, so max_redemptions means people, not clicks.
  if (started.created) await countRedemption(coupon.id);
  return started;
}

/** Compare-and-set on the count, so two redemptions at the same moment are both counted. */
async function countRedemption(couponId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data } = await supabase.from("coupons").select("redeemed_count").eq("id", couponId).maybeSingle<{ redeemed_count: number }>();
    if (!data) return;
    const { data: updated } = await supabase
      .from("coupons")
      .update({ redeemed_count: data.redeemed_count + 1 })
      .eq("id", couponId)
      .eq("redeemed_count", data.redeemed_count)
      .select("id");
    if (updated?.length) return;
  }
  console.error(`[checkout] could not count a redemption of coupon ${couponId} after 5 attempts`);
}
