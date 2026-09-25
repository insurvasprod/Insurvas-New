// The admin Subscriptions list's arithmetic (board p-adm-subscriptions), kept pure so it can be
// tested without a database. lib/subscriptionsList/board.ts reads the rows; this file decides what
// they mean and how they print.
//
// Plain module on purpose: the page (server) and the table (client) both import from here, and the
// test runs it under --experimental-strip-types, so it has no runtime imports.

import type { SubscriptionStatus } from "@/lib/subscriptions/access";
import type { BillingCycle } from "@/lib/money";

export const DAY_MS = 86_400_000;

/** "3 end this week" on the Trialling tile: a trial whose end falls in the next seven days. */
export const TRIAL_WEEK_DAYS = 7;

/** The raw subscription as the board reads it. */
export type SubscriptionListInput = {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  plan_id: string;
  plan_code: string | null;
  plan_name: string | null;
  plan_version: number | null;
  pending_plan_id: string | null;
  pending_plan_name: string | null;
  pending_plan_version: number | null;
  status: SubscriptionStatus;
  billing_cycle: BillingCycle;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancel_reason: string | null;
  cancelled_at: string | null;
  started_at: string;
};

export type PlanPriceRow = {
  plan_id: string;
  price_monthly_cents: number | null;
  price_quarterly_cents: number | null;
  price_yearly_cents: number | null;
};

/* ── status ─────────────────────────────────────────────────────────────── */

export type ListTone = "success" | "warning" | "error" | "neutral";

/**
 * How the list names each state. The board separates two facts the enum spells confusingly:
 * `cancelling` is a subscription that has been CANCELLED but keeps access until its period ends,
 * and `cancelled` is one whose access has ENDED — "Expired" here, so the two never read alike.
 */
export const LIST_STATUS: Record<SubscriptionStatus, { label: string; tone: ListTone }> = {
  active: { label: "Active", tone: "success" },
  trialing: { label: "Trialling", tone: "warning" },
  past_due: { label: "Past due", tone: "warning" },
  suspended: { label: "Suspended", tone: "error" },
  paused: { label: "Paused", tone: "neutral" },
  cancelling: { label: "Cancelled", tone: "error" },
  cancelled: { label: "Expired", tone: "neutral" },
};

/** The order the Status filter lists the states in: live first, ended last. */
export const LIST_STATUS_ORDER: readonly SubscriptionStatus[] = [
  "active",
  "trialing",
  "past_due",
  "suspended",
  "paused",
  "cancelling",
  "cancelled",
];

/** Whether the subscription's access has ended (the enum's `cancelled`). */
export function isExpired(row: Pick<SubscriptionListInput, "status">): boolean {
  return row.status === "cancelled";
}

/**
 * Cancelled, still in period: the period roll (advance_billing_periods) ends it at the boundary.
 * Either marker counts — an admin cancel sets both, a provider event may set only the status.
 */
export function isEndingInPeriod(row: Pick<SubscriptionListInput, "status" | "cancel_at_period_end">): boolean {
  if (isExpired(row)) return false;
  return row.status === "cancelling" || row.cancel_at_period_end;
}

/** The states the revenue dashboard counts toward MRR (compute_metrics_for_date). */
export const REVENUE_BEARING: ReadonlySet<SubscriptionStatus> = new Set<SubscriptionStatus>(["active", "past_due", "cancelling"]);

/* ── money ──────────────────────────────────────────────────────────────── */

/**
 * The plan's monthly equivalent, exactly as `public.monthly_equivalent_cents` computes it (the
 * function the revenue snapshot sums): the cycle's price over its months, rounded, 0 when unpriced.
 * Mirrored rather than called per subscription so the tile costs one read of plan_prices.
 */
export function monthlyEquivalentFor(price: PlanPriceRow | undefined, cycle: BillingCycle): number {
  if (!price) return 0;
  const cents =
    cycle === "monthly"
      ? price.price_monthly_cents
      : cycle === "quarterly"
        ? price.price_quarterly_cents === null
          ? null
          : price.price_quarterly_cents / 3
        : price.price_yearly_cents === null
          ? null
          : price.price_yearly_cents / 12;
  return cents === null ? 0 : Math.round(cents);
}

/* ── dates ──────────────────────────────────────────────────────────────── */

// Hand-built rather than Intl: en-GB prints "Sept" in current ICU builds and "Sep" in older ones,
// and the board (and every other admin date) reads "Sep". UTC throughout, so the server render and
// the browser agree.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** "4 Oct 2026". */
export function fullDate(iso: string | null): string {
  const ms = time(iso);
  if (ms === null) return "—";
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "14 Sep" this year, "14 Sep 2025" otherwise. */
export function shortDate(iso: string | null, now: Date): string {
  const ms = time(iso);
  if (ms === null) return "—";
  const d = new Date(ms);
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === now.getUTCFullYear() ? day : `${day} ${d.getUTCFullYear()}`;
}

/** "22 Sep 2026 08:40:55 UTC". */
export function fullUtc(iso: string | null): string {
  const ms = time(iso);
  if (ms === null) return "—";
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

/**
 * "14 Sep – 13 Oct". A period ends AT its end instant (the next one starts there), so the last day
 * it covers is the day before a midnight end — the same reading as the tenant record's
 * Subscription tab, so one subscription prints the same period on both screens.
 */
export function periodRange(start: string | null, end: string | null, now: Date): string {
  if (!start && !end) return "—";
  const endMs = time(end);
  const last = endMs === null ? null : new Date(endMs - 1).toISOString();
  return `${shortDate(start, now)} – ${shortDate(last, now)}`;
}

/* ── queued change ──────────────────────────────────────────────────────── */

export type QueuedKind = "ends" | "plan" | "trial" | "ended" | "none";

/**
 * What the Queued change column says. In priority order: an ending access wins over a queued plan
 * (the period roll cancels before it would switch), then a queued plan, then a trial's end.
 *
 * A trial is "Trial ends", never the board's "Converts": nothing converts a trial by itself — it
 * converts when a payment lands, or lapses — so "Converts 15 Sep" would state a guess as a fact.
 */
export function queuedChange(row: SubscriptionListInput, now: Date): { kind: QueuedKind; text: string } {
  if (isExpired(row)) {
    const at = row.cancelled_at ?? row.current_period_end;
    return { kind: "ended", text: at ? `Ended ${fullDate(at)}` : "Ended" };
  }
  if (isEndingInPeriod(row)) {
    return { kind: "ends", text: row.current_period_end ? `Ends ${fullDate(row.current_period_end)}` : "Ends at period end" };
  }
  if (row.pending_plan_id) {
    const name = row.pending_plan_name ?? "Another plan";
    const version = row.pending_plan_version === null ? "" : ` v${row.pending_plan_version}`;
    return { kind: "plan", text: `${name}${version} at renewal` };
  }
  if (row.status === "trialing") {
    const end = row.trial_ends_at ?? row.current_period_end;
    if (!end) return { kind: "trial", text: "Trial end not set" };
    const past = (time(end) ?? 0) < now.getTime();
    return { kind: "trial", text: `${past ? "Trial ended" : "Trial ends"} ${shortDate(end, now)}` };
  }
  return { kind: "none", text: "—" };
}

/* ── order ──────────────────────────────────────────────────────────────── */

/**
 * The instant the subscription next changes on its own: a trial's end, else the period end.
 * Null when there is none (a live row with no period end, or an expired row).
 */
export function nextBoundary(row: SubscriptionListInput): string | null {
  if (isExpired(row)) return null;
  if (row.status === "trialing") return row.trial_ends_at ?? row.current_period_end;
  return row.current_period_end;
}

/**
 * Soonest period end first; live rows with no period end after those; expired rows last, the most
 * recently ended first. Ties break on the tenant name so the order is stable between renders.
 */
export function compareRows(a: SubscriptionListInput, b: SubscriptionListInput): number {
  const group = (row: SubscriptionListInput) => (isExpired(row) ? 2 : nextBoundary(row) === null ? 1 : 0);
  const ga = group(a);
  const gb = group(b);
  if (ga !== gb) return ga - gb;
  if (ga === 0) {
    const diff = (time(nextBoundary(a)) ?? 0) - (time(nextBoundary(b)) ?? 0);
    if (diff !== 0) return diff;
  }
  if (ga === 2) {
    const diff = (time(b.cancelled_at ?? b.current_period_end) ?? 0) - (time(a.cancelled_at ?? a.current_period_end) ?? 0);
    if (diff !== 0) return diff;
  }
  return (a.tenant_name ?? a.tenant_id).localeCompare(b.tenant_name ?? b.tenant_id) || a.id.localeCompare(b.id);
}

/** The footer's order sentence. It must describe compareRows exactly. */
export const LIST_ORDER = "soonest period end first, expired last";

/* ── figures ────────────────────────────────────────────────────────────── */

export type SubscriptionFigures = {
  active: number;
  /** Distinct plans (any version) the active subscriptions are on. */
  activePlans: number;
  trialling: number;
  /** Trials whose end falls within the next TRIAL_WEEK_DAYS days, overdue ones included. */
  trialsEndingThisWeek: number;
  endingInPeriod: number;
  /** Live subscriptions with a plan change queued for renewal — the old page's fourth tile. */
  queuedPlanChanges: number;
  /** Contracted MRR in cents; null when plan prices could not be read. */
  mrrCents: number | null;
};

export function figuresFor(
  rows: readonly SubscriptionListInput[],
  prices: readonly PlanPriceRow[] | null,
  now: Date,
): SubscriptionFigures {
  const active = rows.filter((r) => r.status === "active");
  const trials = rows.filter((r) => r.status === "trialing");
  const weekEnd = now.getTime() + TRIAL_WEEK_DAYS * DAY_MS;
  const priceBy = prices ? new Map(prices.map((p) => [p.plan_id, p])) : null;

  return {
    active: active.length,
    activePlans: new Set(active.map((r) => r.plan_code ?? r.plan_id)).size,
    trialling: trials.length,
    trialsEndingThisWeek: trials.filter((r) => {
      const end = time(r.trial_ends_at ?? r.current_period_end);
      return end !== null && end <= weekEnd;
    }).length,
    endingInPeriod: rows.filter(isEndingInPeriod).length,
    queuedPlanChanges: rows.filter((r) => !isExpired(r) && r.pending_plan_id !== null).length,
    mrrCents: priceBy
      ? rows
          .filter((r) => REVENUE_BEARING.has(r.status))
          .reduce((sum, r) => sum + monthlyEquivalentFor(priceBy.get(r.plan_id), r.billing_cycle), 0)
      : null,
  };
}

/* ── display rows ───────────────────────────────────────────────────────── */

/** One table row, formatted on the server so the client prints exactly what the server did. */
export type SubscriptionListRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  planId: string;
  planName: string;
  planVersion: number | null;
  cycle: BillingCycle;
  status: SubscriptionStatus;
  queuedKind: QueuedKind;
  queuedText: string;
  periodText: string;
  /** Hover text for the period cell: both instants to the second, UTC. */
  periodFull: string;
  periodStart: string | null;
  periodEnd: string | null;
  startedAt: string;
  startedFull: string;
  trialEndsAt: string | null;
  trialEndsFull: string | null;
  cancelledAt: string | null;
  cancelledFull: string | null;
  cancelReason: string | null;
  pendingPlanLabel: string | null;
  /** The plan's monthly equivalent; null when prices could not be read. */
  monthlyCents: number | null;
  countsTowardMrr: boolean;
};

export function toListRow(row: SubscriptionListInput, priceBy: Map<string, PlanPriceRow> | null, now: Date): SubscriptionListRow {
  const queued = queuedChange(row, now);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name ?? row.tenant_id,
    planId: row.plan_id,
    planName: row.plan_name ?? "Unknown plan",
    planVersion: row.plan_version,
    cycle: row.billing_cycle,
    status: row.status,
    queuedKind: queued.kind,
    queuedText: queued.text,
    periodText: periodRange(row.current_period_start, row.current_period_end, now),
    periodFull: `${fullUtc(row.current_period_start)} to ${fullUtc(row.current_period_end)}`,
    periodStart: row.current_period_start,
    periodEnd: row.current_period_end,
    startedAt: row.started_at,
    startedFull: fullUtc(row.started_at),
    trialEndsAt: row.trial_ends_at,
    trialEndsFull: row.trial_ends_at ? fullUtc(row.trial_ends_at) : null,
    cancelledAt: row.cancelled_at,
    cancelledFull: row.cancelled_at ? fullUtc(row.cancelled_at) : null,
    cancelReason: row.cancel_reason,
    pendingPlanLabel: row.pending_plan_id
      ? `${row.pending_plan_name ?? "Another plan"}${row.pending_plan_version === null ? "" : ` v${row.pending_plan_version}`}`
      : null,
    monthlyCents: priceBy ? monthlyEquivalentFor(priceBy.get(row.plan_id), row.billing_cycle) : null,
    countsTowardMrr: REVENUE_BEARING.has(row.status),
  };
}
