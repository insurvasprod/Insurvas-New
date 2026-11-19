import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { paymentMethodUrl } from "@/lib/billing/selfService";
import { emailButton, emailParagraph, emailShell, escapeHtml } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/transport";
import { cardLinkEmail } from "@/lib/failedPayments/cardLink";
import { formatCentsAsCurrency } from "@/lib/money";
import { CAN_MANAGE_SUBSCRIPTIONS } from "@/lib/subscriptions/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { PROVIDER_RETRY_DAYS } from "@/lib/failedPayments/model";

/**
 * POST /api/admin/billing/failed-payments/card-link — "Send the customer a link to update their card" on Admin ›
 * Billing › Failed payments (billing-r2 screen 4). Whop cannot retry a charge on request through our integration,
 * so this is the board's fallback: the provider's own card page for the customer's membership
 * (lib/billing/selfService.ts paymentMethodUrl, the page the customer reaches from Plan & billing), emailed to the
 * workspace owner. Only for a subscription that is past due. Same roles as Subscriptions (CAN_MANAGE_SUBSCRIPTIONS);
 * one audit row per email.
 */

const schema = z.object({ subscriptionId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_SUBSCRIPTIONS);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a subscription" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- webhook_events and the joins are read loosely
  const db = getSupabaseServiceClient() as any;
  const sub = await db.from("subscriptions").select("id, tenant_id, status, plan_id, billing_cycle, tenants(name)").eq("id", parsed.data.subscriptionId).maybeSingle();
  if (sub.error) return NextResponse.json({ error: "Could not read the subscription" }, { status: 500 });
  if (!sub.data) return NextResponse.json({ error: "No such subscription" }, { status: 404 });
  if (sub.data.status !== "past_due") return NextResponse.json({ error: "This customer is no longer past due" }, { status: 409 });
  const tenantId = sub.data.tenant_id as string;

  const [owner, profile, prices, failed] = await Promise.all([
    db.from("tenant_users").select("users!tenant_users_user_id_fkey(email, name)").eq("tenant_id", tenantId).eq("role", "owner").limit(1).maybeSingle(),
    db.from("business_profiles").select("business_name").eq("tenant_id", tenantId).maybeSingle(),
    db.from("plan_prices").select("price_monthly_cents, price_quarterly_cents, price_yearly_cents").eq("plan_id", sub.data.plan_id).maybeSingle(),
    db.from("webhook_events").select("occurred_at, received_at").eq("tenant_id", tenantId).eq("event_type", "payment.failed").order("received_at", { ascending: false }).limit(20),
  ]);
  const user = owner.data?.users as { email?: string; name?: string | null } | null | undefined;
  if (!user?.email) return NextResponse.json({ error: "This customer has no owner email to send to. Open the customer instead." }, { status: 409 });

  let url: string | null = null;
  try {
    url = await paymentMethodUrl(tenantId);
  } catch (error) {
    console.error("[admin/failed-payments] card page lookup failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The payment provider didn't answer. Try again in a minute." }, { status: 502 });
  }
  if (!url) return NextResponse.json({ error: "The provider has no card page for this customer. Open the customer instead." }, { status: 409 });

  const cents = (prices.data as Record<string, number | null> | null)?.[`price_${sub.data.billing_cycle}_cents`] ?? null;
  const failures = ((failed.data ?? []) as { occurred_at: string | null; received_at: string }[]).map((row) => row.occurred_at ?? row.received_at).sort();
  const firstFailure = failures[0] ?? null;
  const business = (profile.data as { business_name?: string | null } | null)?.business_name?.trim() || (sub.data.tenants as { name: string } | null)?.name || "your workspace";
  const email = cardLinkEmail({
    ownerName: user.name ?? null,
    businessName: business,
    amountLabel: typeof cents === "number" ? formatCentsAsCurrency(cents) : null,
    readOnlyAt: firstFailure ? new Date(Date.parse(firstFailure) + PROVIDER_RETRY_DAYS * 86_400_000).toISOString() : null,
    url,
  });
  const html = emailShell(
    escapeHtml(email.headline),
    emailParagraph(`Hi ${escapeHtml(user.name?.trim() || "there")},`) +
      emailParagraph(escapeHtml(email.paragraphs[0])) +
      emailParagraph(escapeHtml(email.paragraphs[1])) +
      emailButton(url, email.buttonLabel) +
      emailParagraph(escapeHtml(email.paragraphs[2])),
    { eyebrow: "Billing", preheader: email.subject },
  );

  const delivery = await sendEmail({
    to: user.email,
    subject: email.subject,
    text: email.text,
    html,
    templateKey: "subscription.payment_failed",
    tenantId,
    dedupeKey: `card-link-${sub.data.id}-${new Date().toISOString().slice(0, 13)}`,
  });

  await audit({
    actorId: auth.session.sub,
    action: "subscription.payment_method_opened",
    targetType: "subscription",
    targetId: sub.data.id,
    metadata: { tenantId, via: "admin_email", to: user.email, delivered: delivery.delivered },
    request,
  });

  if (!delivery.delivered) return NextResponse.json({ error: `The email was not delivered: ${delivery.reason}` }, { status: 502 });
  return NextResponse.json({ ok: true, to: user.email });
}
