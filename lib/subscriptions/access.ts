// Client-safe. What each subscription state lets a tenant DO — the tenant-plane half of the
// contract in the Basic Idea doc §6.2.

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "suspended",
  "paused",
  "cancelling",
  "cancelled",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  suspended: "Suspended",
  paused: "Paused",
  cancelling: "Cancelling",
  cancelled: "Cancelled",
};

/**
 * `full`      — everything the plan grants.
 * `read_only` — can SEE their book of business, cannot DO anything that creates or dials.
 * `none`      — no access (only after the retention window, which SA-6.3 owns).
 */
export type AccessLevel = "full" | "read_only" | "none";

/**
 * THE rule that must not be broken (doc §5.4 and SA-2.7): a suspended tenant can always still
 * read their own book of business. Suspend the doing, preserve the seeing.
 *
 * Everything that gates tenant-side behaviour derives from this one function, so the rule lives
 * in exactly one place rather than being re-derived per screen.
 */
export function accessLevelForStatus(status: SubscriptionStatus): AccessLevel {
  switch (status) {
    case "trialing":
    case "active":
    case "past_due": // Full access with a banner — chasing payment must not break the product.
    case "cancelling": // Paid through the end of the term, so still entitled to it.
      return "full";
    case "suspended":
    case "paused":
      return "read_only";
    case "cancelled":
      return "none";
  }
}

/** Whether the agent should see a "your payment failed" style banner. */
export function needsPaymentBanner(status: SubscriptionStatus): boolean {
  return status === "past_due" || status === "suspended";
}

export const SUBSCRIPTION_STATUS_BADGE_CLASS: Record<SubscriptionStatus, string> = {
  trialing: "border-transparent bg-[var(--color-blue)]/10 text-[var(--color-blue)]",
  active: "border-transparent bg-[var(--color-success)]/10 text-[var(--color-success)]",
  past_due: "border-transparent bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
  suspended: "border-transparent bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
  paused: "border-transparent bg-muted text-muted-foreground",
  cancelling: "border-transparent bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
  cancelled: "border-transparent bg-muted text-muted-foreground",
};

/** Which admin actions make sense from a given state — keeps the UI from offering no-ops. */
export function availableActions(status: SubscriptionStatus): {
  canChangePlan: boolean;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
} {
  return {
    canChangePlan: status !== "cancelled",
    canPause: status === "active" || status === "trialing",
    canResume: status === "paused",
    canCancel: status !== "cancelled",
  };
}
