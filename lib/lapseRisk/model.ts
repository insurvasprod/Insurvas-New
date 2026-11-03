/**
 * Lapse risk: what a signal is, how urgent a policy is, and what its lapse would cost.
 *
 * Pure (no I/O, no server-only) so the client components can import the labels and the tests can
 * import the ordering. The service (./service.ts) reads the rows and hands them here.
 *
 * A policy is at risk only while it carries at least one OPEN signal — a missed draft, a returned
 * payment, a service call, or an "other" that someone wrote a reason for. There is no score: the
 * board's rule is that a risk without a reason is not actionable, so the reason IS the risk.
 */

export const LAPSE_SIGNAL_KINDS = ["returned_payment", "missed_draft", "service_call", "other"] as const;
export type LapseSignalKind = (typeof LAPSE_SIGNAL_KINDS)[number];

export const LAPSE_SIGNAL_LABELS: Record<LapseSignalKind, string> = {
  returned_payment: "Returned payment",
  missed_draft: "Missed draft",
  service_call: "Service call",
  other: "Other",
};

/** Resolutions a person may choose. `policy_cancelled` exists in the table but only a trigger writes it. */
export const LAPSE_RESOLUTIONS = ["payment_received", "policy_reinstated", "false_alarm", "policy_lapsed"] as const;
export type LapseResolution = (typeof LAPSE_RESOLUTIONS)[number];

export const LAPSE_RESOLUTION_LABELS: Record<LapseResolution, string> = {
  payment_received: "Payment received",
  policy_reinstated: "Policy reinstated",
  false_alarm: "False alarm",
  policy_lapsed: "Lapsed",
};

export const LAPSE_SIGNAL_NOTE_MAX = 1000;
/** "Other" is only a reason when it is written down; the table enforces the same minimum. */
export const OTHER_NOTE_MIN = 3;

/**
 * How much a kind of signal says about an imminent lapse. A returned payment is money that did not
 * arrive; a missed draft is a draft that did not run (and may still); a service call is a customer
 * asking about the policy, which is often a cancellation in the making but not yet a missed dollar.
 */
export const LAPSE_SIGNAL_SEVERITY: Record<LapseSignalKind, number> = {
  returned_payment: 3,
  missed_draft: 2,
  service_call: 1,
  other: 0,
};

/** One line on the page, and the order `rankAtRisk` implements. Keep them in step. */
export const URGENCY_RULE =
  "Most urgent first: a returned payment, then a missed draft, then a service call — then more open signals, the oldest signal, and the larger commission exposed.";

export type OpenSignal = {
  id: string;
  kind: LapseSignalKind;
  /** YYYY-MM-DD. */
  occurredOn: string;
  note: string | null;
  source: "manual" | "feed";
  recordedAt: string;
  recordedByName: string | null;
};

/** What a lapse today would charge back, or why there is no figure. */
export type CommissionExposed =
  | { state: "exposed"; cents: number; clawbackEndsOn: string; clawbackType: "full" | "prorated" }
  | { state: "outside_window" }
  | { state: "not_issued" }
  | { state: "no_rule"; reason: string };

export type AtRiskPolicy = {
  policyId: string;
  policyNumber: string;
  insuredName: string;
  carrier: string;
  product: string;
  status: "active" | "pending";
  annualPremiumCents: number;
  monthlyPremiumCents: number;
  signals: OpenSignal[];
  exposure: CommissionExposed;
};

/** The ledger's per-policy exposure and gaps, in the shape lib/ledger/compute.ts returns them. */
export type LedgerExposureInput = {
  exposure: Array<{ policyId: string; exposureCents: number; clawbackEndsOn: string; clawbackType: "full" | "prorated" }>;
  gaps: Array<{ policyId: string; reason: string }>;
};

/**
 * The commission a policy exposes, from the ledger's own figures.
 *
 * The ledger lists exposure only for an active policy still inside its advance rule's clawback
 * months. A policy missing from that list is NOT necessarily safe: a pending policy has not been
 * issued, and a policy the carrier library cannot price is a gap, not a zero. Saying "outside the
 * clawback window" for either would be a guess presented as a fact.
 */
export function exposureFor(policy: { id: string; status: string }, ledger: LedgerExposureInput): CommissionExposed {
  const hit = ledger.exposure.find((item) => item.policyId === policy.id);
  if (hit) return { state: "exposed", cents: hit.exposureCents, clawbackEndsOn: hit.clawbackEndsOn, clawbackType: hit.clawbackType };
  if (policy.status === "pending") return { state: "not_issued" };
  const gap = ledger.gaps.find((item) => item.policyId === policy.id);
  if (gap) return { state: "no_rule", reason: gap.reason };
  return { state: "outside_window" };
}

export function exposedCents(exposure: CommissionExposed): number {
  return exposure.state === "exposed" ? exposure.cents : 0;
}

function topSeverity(signals: OpenSignal[]): number {
  return signals.reduce((top, signal) => Math.max(top, LAPSE_SIGNAL_SEVERITY[signal.kind] ?? 0), -1);
}

function oldestSignal(signals: OpenSignal[]): string {
  return signals.reduce((oldest, signal) => (signal.occurredOn < oldest ? signal.occurredOn : oldest), "9999-12-31");
}

/**
 * Most urgent first, by a rule a person can check by reading the row:
 *   1. the most serious open signal (returned payment > missed draft > service call > other);
 *   2. then more open signals;
 *   3. then the oldest open signal — it has been at risk longest;
 *   4. then the larger commission exposed;
 *   5. then policy number, so equal rows never shuffle between loads.
 * Signals inside each row are ordered the same way: most serious, then oldest.
 */
export function rankAtRisk(policies: AtRiskPolicy[]): AtRiskPolicy[] {
  return policies
    .map((policy) => ({
      ...policy,
      signals: [...policy.signals].sort(
        (a, b) => LAPSE_SIGNAL_SEVERITY[b.kind] - LAPSE_SIGNAL_SEVERITY[a.kind] || a.occurredOn.localeCompare(b.occurredOn) || a.recordedAt.localeCompare(b.recordedAt),
      ),
    }))
    .sort(
      (a, b) =>
        topSeverity(b.signals) - topSeverity(a.signals) ||
        b.signals.length - a.signals.length ||
        oldestSignal(a.signals).localeCompare(oldestSignal(b.signals)) ||
        exposedCents(b.exposure) - exposedCents(a.exposure) ||
        a.policyNumber.localeCompare(b.policyNumber),
    );
}

export type AtRiskTotals = {
  policies: number;
  annualPremiumCents: number;
  monthlyPremiumCents: number;
  commissionExposedCents: number;
  /** Policies whose exposure could not be figured (not issued, or no rule on file). */
  unpriced: number;
};

export function totalsAtRisk(policies: AtRiskPolicy[]): AtRiskTotals {
  return {
    policies: policies.length,
    annualPremiumCents: policies.reduce((sum, policy) => sum + policy.annualPremiumCents, 0),
    monthlyPremiumCents: policies.reduce((sum, policy) => sum + policy.monthlyPremiumCents, 0),
    commissionExposedCents: policies.reduce((sum, policy) => sum + exposedCents(policy.exposure), 0),
    unpriced: policies.filter((policy) => policy.exposure.state === "not_issued" || policy.exposure.state === "no_rule").length,
  };
}

/** The book stores annual premium; the board shows the monthly draft beside it. */
export function monthlyPremiumCents(annualPremiumCents: number): number {
  return Math.round(annualPremiumCents / 12);
}

export function isLapseSignalKind(value: unknown): value is LapseSignalKind {
  return typeof value === "string" && (LAPSE_SIGNAL_KINDS as readonly string[]).includes(value);
}
