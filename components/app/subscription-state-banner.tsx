import { AlertCircle, LockKeyhole } from "lucide-react";

import type { SubscriptionStatus } from "@/lib/subscriptions/access";

/**
 * The subscription state is part of the cached entitlement contract, so the agent shell can
 * explain payment access without loading subscriptions, plans, or prices.
 */
export function SubscriptionStateBanner({ status }: { status: SubscriptionStatus | null }) {
  if (!status || !["past_due", "suspended", "paused"].includes(status)) return null;

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
        <p className="font-semibold text-[var(--color-blue)]">Contact your administrator</p>
      </div>
    );
  }

  return (
    <div role="status" className="mb-6 flex flex-wrap items-start gap-3 rounded-lg border border-[var(--color-danger)]/35 bg-[var(--color-danger)]/10 p-4 text-sm">
      <LockKeyhole className="mt-0.5 size-5 shrink-0 text-[var(--color-danger)]" aria-hidden="true" />
      <div>
        <p className="font-semibold">Your account is {status === "paused" ? "paused" : "suspended"}</p>
        <p className="mt-1 text-muted-foreground">
          Your book of business remains available to read, but creating, dialing, and sending are
          disabled until payment is restored. Contact your administrator to reactivate access.
        </p>
      </div>
    </div>
  );
}
