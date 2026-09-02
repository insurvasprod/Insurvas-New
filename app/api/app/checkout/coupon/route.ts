import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { resolveSignupContext } from "@/lib/signup/context";
import { checkCoupon } from "@/lib/checkout/start";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const schema = z.object({ code: z.string().trim().min(1).max(40) });

/**
 * Validates a coupon before checkout opens — the ticket's criterion that an invalid code is
 * rejected here rather than after the customer has been sent to a hosted page.
 *
 * It does NOT apply the discount, and says so (bugs_sa.md #2). Whop's hosted checkout
 * configuration API has no promo-code field — `promoCode` exists only on their embedded checkout
 * element — so nothing we send when opening the checkout can pre-apply one. The buyer has to type
 * the code on Whop's page.
 *
 * The code we return is the one that works: coupons are created at Whop with the same string the
 * admin typed, so this is a real discount, just not an automatic one. Previously this replied
 * `{ ok: true, code }` and the UI announced "will be applied at checkout", which was false — the
 * customer was told they had a discount and then charged full price.
 */
export async function POST(request: NextRequest) {
  const context = await resolveSignupContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (context.role !== "owner") {
    return NextResponse.json({ error: "Only the tenant owner can manage billing" }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a code" }, { status: 400 });

  const supabase = getSupabaseServiceClient();
  const { data: selection } = await supabase
    .from("signup_selections")
    .select("plan_id")
    .eq("tenant_id", context.tenantId)
    .maybeSingle<{ plan_id: string }>();

  if (!selection) return NextResponse.json({ error: "No plan selected" }, { status: 409 });

  const result = await checkCoupon(parsed.data.code, selection.plan_id);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

  return NextResponse.json({
    ok: true,
    code: result.code,
    // Explicit rather than implied, so a future caller cannot read `ok: true` as "discounted".
    mustEnterAtCheckout: true,
    instruction: `Enter ${result.code} on the payment page to get your discount.`,
  });
}
