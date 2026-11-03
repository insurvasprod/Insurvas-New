// Client-safe formatting for the Subscription & billing tab. Fixed locale and UTC, so the server
// render and the browser render print the same date and React has nothing to reconcile.

import { formatCentsAsCurrency, type BillingCycle } from "@/lib/money";
import type { SubscriptionStatus } from "@/lib/subscriptions/access";
import { recordDate, recordDayMonth } from "@/lib/tenants/recordFormat";


/** "4 Mar 2025". */
export function fullDate(iso: string | null): string {
  return recordDate(iso);
}

/** "14 Sep" this year, "14 Sep 2025" otherwise — the year only where it adds information. */
export function shortDate(iso: string | Date | null, now: Date = new Date()): string {
  if (!iso) return "—";
  const date = iso instanceof Date ? iso : new Date(iso);
  const value = date.toISOString();
  return date.getUTCFullYear() === now.getUTCFullYear() ? recordDayMonth(value) : recordDate(value);
}

/**
 * "14 Sep – 13 Oct". A period ends AT its end instant (the next period starts there), so the last
 * day it covers is the day before a midnight end. One millisecond back lands on that day.
 */
export function periodRange(start: string | null, end: string | null, now: Date = new Date()): string {
  if (!start && !end) return "—";
  const last = end ? new Date(new Date(end).getTime() - 1) : null;
  return `${shortDate(start, now)} – ${shortDate(last, now)}`;
}

const CYCLE_UNIT: Record<BillingCycle, string> = { monthly: "month", quarterly: "quarter", yearly: "year" };

/** "$99.00 / month" — flat plan pricing; nothing here is priced per seat. */
export function priceCopy(cents: number | null, cycle: BillingCycle): string {
  return cents === null ? `Not priced per ${CYCLE_UNIT[cycle]}` : `${formatCentsAsCurrency(cents)} / ${CYCLE_UNIT[cycle]}`;
}

/** The statuses the revenue dashboard counts toward MRR (compute_metrics_for_date). */
export function countsTowardMrr(status: SubscriptionStatus): boolean {
  return status === "active" || status === "past_due" || status === "cancelling";
}

/** "A", "A and B", "A, B and C". */
export function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
