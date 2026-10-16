import { NextResponse } from "next/server";

import { audit } from "@/lib/audit/log";
import { paymentMethodUrl } from "@/lib/billing/selfService";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";

/** Whop's signed-in membership page, when a membership has no manage_url of its own. */
const WHOP_MEMBERSHIPS = "https://whop.com/@me/settings/memberships";

/**
 * Settings › Plan & billing › Update card (LA-8.5). The card lives with the payment provider (SA-3)
 * and never passes through us: this sends the owner to Whop's own billing page for their membership.
 */
export async function GET(request: Request) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const url = await paymentMethodUrl(auth.context.tenantId).catch(() => WHOP_MEMBERSHIPS);
    if (url === null) return NextResponse.json({ error: "There is no card on file for this workspace — invoices are paid by their own link." }, { status: 404 });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "subscription.payment_method_opened", targetType: "tenant", targetId: auth.context.tenantId, metadata: { tenantId: auth.context.tenantId }, request });
    return NextResponse.redirect(url, 303);
  } catch (error) {
    console.error("[billing/payment-method]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The card page could not be opened" }, { status: 500 });
  }
}
