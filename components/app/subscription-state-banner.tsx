import Link from "next/link";
import { AlertCircle, LockKeyhole } from "lucide-react";

import type { SubscriptionStatus } from "@/lib/subscriptions/access";

/**
 * The subscription state is part of the cached entitlement contract, so the agent shell can
 * explain payment access without loading subscriptions, plans, or prices.
 *
 * LA-8.5: the owner fixes it themselves on Settings › Plan & billing (the card, a resume, the
 * dates); everyone else is told to ask them.
 */
export function SubscriptionStateBanner({ status, isOwner = false }: { status: SubscriptionStatus | null; isOwner?: boolean }) {
  if (!status || !["past_due", "suspended", "paused", "cancelled"].includes(status)) return null;

  const action = isOwner ? (
    <Link href="/app/settings#billing" className="font-semibold text-[var(--color-brand)]">Open Plan &amp; billing</Link>
  ) : (
    <p className="font-semibold text-[var(--color-brand)]">Contact your agency owner</p>
  );

  if (status === "past_due") {
    return (
      <div role="alert" className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-4 text-sm">
        <div className="flex gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
          <div>
            <p className="font-semibold">Payment needs attention</p>
            <p className="mt-1 max-w-2xl text-muted-foreground">
              Your last payment did not go through. You still have full access for now; update your
              payment details before access becomes read-only.
            </p>
          </div>
        </div>
        {action}
      </div>
    );
  }

  const title = status === "paused" ? "Your account is paused" : status === "cancelled" ? "Your subscription has ended" : "Your account is suspended";
  const body =
    status === "cancelled"
      ? "Your book of business, statements and commission history stay available to read and export for a limited time, but creating, dialing and sending are disabled."
      : "Your book of business remains available to read, but creating, dialing, and sending are disabled until the subscription is active again.";
  return (
    <div role="status" className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-lg border border-[var(--color-danger)]/35 bg-[var(--color-danger)]/10 p-4 text-sm">
      <div className="flex gap-3">
        <LockKeyhole className="mt-0.5 size-5 shrink-0 text-[var(--color-danger)]" aria-hidden="true" />
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-1 max-w-2xl text-muted-foreground">{body}</p>
        </div>
      </div>
      {action}
    </div>
  );
}
