import Link from "next/link";
import { AlertCircle, LockKeyhole } from "lucide-react";

import { PageAlert } from "@/components/ui/page-alert";
import type { SubscriptionStatus } from "@/lib/subscriptions/access";

/** The states the shell flags on every page. */
export function subscriptionNeedsAlert(status: SubscriptionStatus | null): boolean {
  return Boolean(status && ["past_due", "suspended", "paused", "cancelled"].includes(status));
}

/**
 * The subscription state is part of the cached entitlement contract, so the agent shell can
 * explain payment access without loading subscriptions, plans, or prices.
 *
 * LA-8.5: the owner fixes it themselves on Settings › Plan & billing (the card, a resume, the
 * dates); everyone else is told to ask them. It sits on the page title's line (owner 2026-11-02);
 * the full sentence is the tooltip.
 */
export function SubscriptionStateBanner({ status, isOwner = false }: { status: SubscriptionStatus | null; isOwner?: boolean }) {
  if (!subscriptionNeedsAlert(status)) return null;

  const action = isOwner ? <Link href="/app/settings#billing">Open Plan &amp; billing</Link> : "Ask your agency owner";

  if (status === "past_due") {
    return (
      <PageAlert
        role="alert"
        tone="warning"
        icon={<AlertCircle />}
        text="Payment needs attention: your last payment did not go through. You still have full access for now; update your payment details before access becomes read-only."
        action={action}
      />
    );
  }

  const title = status === "paused" ? "Your account is paused" : status === "cancelled" ? "Your subscription has ended" : "Your account is suspended";
  const body =
    status === "cancelled"
      ? "Your book of business, statements and commission history stay available to read and export for a limited time, but creating, dialing and sending are disabled."
      : "Your book of business remains available to read, but creating, dialing, and sending are disabled until the subscription is active again.";
  return <PageAlert role="status" tone="error" icon={<LockKeyhole />} text={`${title}. ${body}`} action={action} />;
}
