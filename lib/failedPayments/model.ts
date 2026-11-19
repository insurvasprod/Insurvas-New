// Admin › Billing › Failed payments (admin round 1, billing-r2 screen 4; Notion §6.5 dunning queue). Pure, so the
// ladder, the episodes and the figures are tested on their own (model.test.mjs); reads.ts reads the rows.
//
// The retry ladder is the provider's, not ours: Whop retries a failed card over five days and then cancels the
// membership (lib/billing/selfServiceRules.ts PROVIDER_RETRY_DAYS), and each payment.failed event names the next
// attempt. So the ladder's state is read from those events, with no table of our own: failed → tried again on →
// next retry → read-only on (the fifth day). Recovered and lost are read from the same events over 90 days.

export const PROVIDER_RETRY_DAYS = 5;
export const HISTORY_DAYS = 90;
export const RECENT_DAYS = 30;
const DAY_MS = 86_400_000;

export type PaymentEvent = { tenantId: string; type: string; at: string; nextAttemptAt: string | null; reason: string | null };

export type LadderStep = { key: string; label: string; at: string | null; state: "done" | "next" | "later" };

export type Ladder = {
  failedAt: string | null;
  triedAgainOn: string[];
  nextRetryAt: string | null;
  /** When the provider cancels and the workspace goes read-only: the fifth day after the first failure. */
  readOnlyAt: string | null;
  reason: string | null;
  steps: LadderStep[];
};

/** The attempts since the tenant's last success, oldest first (every payment.failed is one attempt). */
export function attemptsSinceSuccess(events: readonly PaymentEvent[]): PaymentEvent[] {
  const newestFirst = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const out: PaymentEvent[] = [];
  let pastDue: PaymentEvent | null = null;
  for (const event of newestFirst) {
    if (event.type === "payment.succeeded") break;
    if (event.type === "payment.failed") out.push(event);
    else if (event.type === "invoice.past_due") pastDue = event;
  }
  // An invoice that went past due with no failed payment on record still dates the failure.
  if (!out.length && pastDue) out.push({ ...pastDue, nextAttemptAt: null });
  return out.reverse();
}

export function ladderFor(events: readonly PaymentEvent[], now: number): Ladder {
  const attempts = attemptsSinceSuccess(events);
  if (!attempts.length) return { failedAt: null, triedAgainOn: [], nextRetryAt: null, readOnlyAt: null, reason: null, steps: [] };
  const failedAt = attempts[0].at;
  const readOnlyAt = new Date(Date.parse(failedAt) + PROVIDER_RETRY_DAYS * DAY_MS).toISOString();
  const latest = attempts[attempts.length - 1];
  const named = latest.nextAttemptAt && Date.parse(latest.nextAttemptAt) > now ? latest.nextAttemptAt : null;
  // A retry the provider names after the cut-off will not happen: the membership is cancelled first.
  const nextRetryAt = named && Date.parse(named) < Date.parse(readOnlyAt) ? new Date(Date.parse(named)).toISOString() : null;
  const reason = [...attempts].reverse().find((a) => a.reason)?.reason ?? null;
  const triedAgainOn = attempts.slice(1).map((a) => a.at);
  const steps: LadderStep[] = [
    { key: "failed", label: "Failed", at: failedAt, state: "done" },
    ...triedAgainOn.map((at, index): LadderStep => ({ key: `retry-${index}`, label: "Retried", at, state: "done" })),
    ...(nextRetryAt ? [{ key: "next", label: "Next retry", at: nextRetryAt, state: "next" } as LadderStep] : []),
    { key: "read-only", label: "Read-only", at: readOnlyAt, state: Date.parse(readOnlyAt) <= now ? "done" : nextRetryAt ? "later" : "next" },
  ];
  return { failedAt, triedAgainOn, nextRetryAt, readOnlyAt, reason, steps };
}

export type Episode = { tenantId: string; failedAt: string; endedAt: string | null; outcome: "recovered" | "lost" | "open"; reason: string | null };

/**
 * Each run of failures per customer: it opens at a payment.failed and closes at the next payment.succeeded
 * (recovered). One still open is lost when the customer's subscription has since been suspended or cancelled
 * (`lostAt` names when), else it is still open (past due now, or settled some way the events do not show).
 */
export function episodesFrom(events: readonly PaymentEvent[], lostAt: ReadonlyMap<string, string>): Episode[] {
  const byTenant = new Map<string, PaymentEvent[]>();
  for (const event of events) {
    const list = byTenant.get(event.tenantId);
    if (list) list.push(event);
    else byTenant.set(event.tenantId, [event]);
  }
  const episodes: Episode[] = [];
  for (const [tenantId, list] of byTenant) {
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let open: Episode | null = null;
    for (const event of list) {
      if (event.type === "payment.failed") {
        if (!open) open = { tenantId, failedAt: event.at, endedAt: null, outcome: "open", reason: event.reason };
        else if (event.reason) open.reason = event.reason;
      } else if (event.type === "payment.succeeded" && open) {
        episodes.push({ ...open, endedAt: event.at, outcome: "recovered" });
        open = null;
      }
    }
    if (open) {
      const lost = lostAt.get(tenantId);
      episodes.push(lost && Date.parse(lost) >= Date.parse(open.failedAt) ? { ...open, endedAt: lost, outcome: "lost" } : open);
    }
  }
  return episodes.sort((a, b) => Date.parse(b.endedAt ?? b.failedAt) - Date.parse(a.endedAt ?? a.failedAt));
}

export type RecoveryFigures = {
  recovered30: number;
  lost30: number;
  /** Recovered in the 30 days before those, for the change beside the figure. */
  recoveredPrior30: number;
  /** Recovered of closed episodes over HISTORY_DAYS; null when none has closed. */
  rate90: number | null;
};

export function recoveryFigures(episodes: readonly Episode[], now: number): RecoveryFigures {
  const since = (days: number) => now - days * DAY_MS;
  const ended = (e: Episode, from: number, to = now) => e.endedAt !== null && Date.parse(e.endedAt) >= from && Date.parse(e.endedAt) <= to;
  const closed90 = episodes.filter((e) => e.outcome !== "open" && ended(e, since(HISTORY_DAYS)));
  const recovered90 = closed90.filter((e) => e.outcome === "recovered").length;
  return {
    recovered30: episodes.filter((e) => e.outcome === "recovered" && ended(e, since(RECENT_DAYS))).length,
    lost30: episodes.filter((e) => e.outcome === "lost" && ended(e, since(RECENT_DAYS))).length,
    recoveredPrior30: episodes.filter((e) => e.outcome === "recovered" && ended(e, since(2 * RECENT_DAYS), since(RECENT_DAYS))).length,
    rate90: closed90.length ? recovered90 / closed90.length : null,
  };
}

/** Why the payment failed, from a webhook payload: Whop's `failure_message` (or an older `failure_reason`). */
export function failureReason(payload: unknown): string | null {
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null;
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  for (const key of ["failure_message", "failure_reason", "decline_reason"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
  }
  return null;
}

/** `next_payment_attempt` (payments API) or `next_payment_attempt_at` (newer payloads). */
export function nextAttempt(payload: unknown): string | null {
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null;
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  for (const key of ["next_payment_attempt", "next_payment_attempt_at"]) {
    const value = record[key];
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
    if (typeof value === "number" && Number.isFinite(value)) return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 14" (UTC). */
export function shortDay(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** The ladder's "Next" column in words: "Retry Nov 17", "Read-only Nov 19", "Read-only since Nov 12". */
export function nextWords(ladder: Ladder, now: number): string {
  if (ladder.nextRetryAt) return `Retry ${shortDay(ladder.nextRetryAt)}`;
  if (ladder.readOnlyAt) return Date.parse(ladder.readOnlyAt) <= now ? `Read-only since ${shortDay(ladder.readOnlyAt)}` : `Read-only ${shortDay(ladder.readOnlyAt)}`;
  return "No retry named";
}
