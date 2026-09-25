/**
 * The admin tenants list (board p-adm-tenants): how one row's status, plan and onboarding read, and
 * the four figures above the table. Plain module, no `server-only`: the server page computes the
 * figures and the client table filters by the same labels, so both sides must agree.
 *
 * Two axes, chipped differently on purpose (the board's closing callout):
 *
 *   status       what the agency can do today. The tenant's own state (suspended, cancelled,
 *                provisioning) wins; an active tenant whose live subscription is trialing reads as
 *                Trial; everything else active is Active.
 *   onboarding   whether the owner finished setting up. Independent of status — a suspended agency
 *                can have completed onboarding, and a trialling one may not have.
 */

export type ListStatus = "active" | "trial" | "provisioning" | "suspended" | "cancelled";

export const LIST_STATUSES: readonly ListStatus[] = ["active", "trial", "provisioning", "suspended", "cancelled"];

export const LIST_STATUS_LABELS: Record<ListStatus, string> = {
  active: "Active",
  trial: "Trial",
  provisioning: "Provisioning",
  suspended: "Suspended",
  cancelled: "Cancelled",
};

/** Pill tones from components/app/settings/primitives (kept as strings so this module stays plain). */
export type ListTone = "success" | "warning" | "error" | "info" | "neutral";

export const LIST_STATUS_TONES: Record<ListStatus, ListTone> = {
  active: "success",
  trial: "warning",
  provisioning: "info",
  suspended: "error",
  cancelled: "neutral",
};

export type TenantListRow = {
  id: string;
  name: string;
  /** tenants.status as stored. */
  tenantStatus: string;
  status: ListStatus;
  onboardingState: string;
  createdAt: string;
  suspendedAt: string | null;
  owner: { name: string; email: string } | null;
  /** The live (not cancelled) subscription's plan; null when nothing has been sold to the tenant. */
  plan: { name: string; version: number | null } | null;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
};

export function listStatus(tenantStatus: string, subscriptionStatus: string | null): ListStatus {
  if (tenantStatus === "suspended") return "suspended";
  if (tenantStatus === "cancelled") return "cancelled";
  if (tenantStatus === "provisioning") return "provisioning";
  if (subscriptionStatus === "trialing") return "trial";
  return "active";
}

/** Both spellings the database holds for a finished onboarding (live data has 'complete' and 'completed'). */
export function onboardingComplete(state: string): boolean {
  return state === "complete" || state === "completed";
}

/** "complete"/"completed" -> "Complete", "ready_for_checkout" -> "Ready for checkout". */
export function onboardingLabel(state: string): string {
  if (onboardingComplete(state)) return "Complete";
  const spaced = state.replace(/_/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : "Unknown";
}

/** Grey once finished; amber while the owner still has something to do. No dot: it is a state, not a status. */
export function onboardingTone(state: string): ListTone {
  return onboardingComplete(state) ? "neutral" : "warning";
}

export type TenantListStats = {
  total: number;
  active: number;
  trial: number;
  provisioning: number;
  suspended: number;
  cancelled: number;
  /** Trials whose end date falls in the next seven days. */
  trialsEndingSoon: number;
  /** Trials still marked trialing although their end date has passed. */
  trialsPastEnd: number;
  /** Whole days since the longest-standing suspension began; null when none carries a date. */
  oldestSuspendedDays: number | null;
};

const DAY_MS = 86_400_000;

export function tenantListStats(rows: readonly TenantListRow[], now: number): TenantListStats {
  const stats: TenantListStats = {
    total: rows.length,
    active: 0,
    trial: 0,
    provisioning: 0,
    suspended: 0,
    cancelled: 0,
    trialsEndingSoon: 0,
    trialsPastEnd: 0,
    oldestSuspendedDays: null,
  };
  for (const row of rows) {
    stats[row.status] += 1;
    if (row.status === "trial" && row.trialEndsAt) {
      const ends = new Date(row.trialEndsAt).getTime();
      if (!Number.isNaN(ends)) {
        if (ends < now) stats.trialsPastEnd += 1;
        else if (ends - now <= 7 * DAY_MS) stats.trialsEndingSoon += 1;
      }
    }
    if (row.status === "suspended" && row.suspendedAt) {
      const since = new Date(row.suspendedAt).getTime();
      if (!Number.isNaN(since)) {
        const days = Math.max(0, Math.floor((now - since) / DAY_MS));
        stats.oldestSuspendedDays = Math.max(stats.oldestSuspendedDays ?? 0, days);
      }
    }
  }
  return stats;
}

/** The search box matches the tenant's name and its owner's name and email. */
export function matchesTenantSearch(row: TenantListRow, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return `${row.name} ${row.owner?.name ?? ""} ${row.owner?.email ?? ""}`.toLowerCase().includes(needle);
}
