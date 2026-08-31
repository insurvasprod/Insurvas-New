// SA-3.8 · Who may give money back, and when a second pair of eyes is required.
//
// Pure and heavily tested, because this is the control the ticket exists for. Whop's API will
// refund whatever an authenticated key asks it to, so nothing downstream enforces any of this —
// if it is wrong here, it is wrong everywhere.

import type { AdminRole } from "@/lib/adminAuth/roles";

export const CREDIT_NOTE_TYPES = ["refund", "credit", "waiver"] as const;
export type CreditNoteType = (typeof CREDIT_NOTE_TYPES)[number];

export const CREDIT_REASONS = [
  "duplicate_charge",
  "service_issue",
  "goodwill",
  "billing_error",
  "cancellation",
  "other",
] as const;
export type CreditReason = (typeof CREDIT_REASONS)[number];

export const CREDIT_REASON_LABELS: Record<CreditReason, string> = {
  duplicate_charge: "Duplicate charge",
  service_issue: "Service issue",
  goodwill: "Goodwill",
  billing_error: "Billing error",
  cancellation: "Cancellation",
  other: "Other",
};

export const CREDIT_NOTE_TYPE_LABELS: Record<CreditNoteType, string> = {
  refund: "Refund — money returned to the card",
  credit: "Credit — applied against future billing",
  waiver: "Waiver — a charge removed before it is billed",
};

/**
 * The coded default. $500, per the permission matrix.
 *
 * SA-4.1 moved the live value into `billing.refund_approval_threshold_cents`. This exists so a
 * client component can render before the server value arrives and so the app is correct with the
 * store unreachable — it is NOT the number to gate on. Resolve the setting server-side and pass
 * it in.
 */
export const DEFAULT_REFUND_APPROVAL_THRESHOLD_CENTS = 50_000;

/**
 * Only a REFUND is gated on amount.
 *
 * A credit or a waiver costs revenue but cannot move money out of the bank account, which is the
 * thing the threshold protects against. Gating them too would train people to route around the
 * approval queue by issuing credits instead.
 *
 * `thresholdCents` is required rather than defaulted on purpose. A default here would let a
 * caller that forgot to resolve the setting silently gate on $500 while the screen next to it
 * says something else — and this is the one control in the product where that divergence moves
 * real money.
 */
export function needsSecondApprover(
  type: CreditNoteType,
  amountCents: number,
  thresholdCents: number,
): boolean {
  return type === "refund" && amountCents > thresholdCents;
}

const CAN_REQUEST: readonly AdminRole[] = ["super_admin", "billing_admin"];

/** Why this admin cannot raise this credit note, or null if they can. */
export function requestRefusalReason(
  role: AdminRole,
  type: CreditNoteType,
  amountCents: number,
): string | null {
  if (!CAN_REQUEST.includes(role)) {
    return "Only a billing admin or super admin can issue refunds and credits.";
  }
  if (amountCents <= 0) return "The amount must be more than zero.";
  if (type === "waiver") {
    // Honest rather than silently accepting something that does nothing: there are no overage
    // lines to waive yet, and an invoice born paid has no pre-issue window to remove one in.
    return "Waivers are not available yet — there are no overage lines to waive (backlog #44).";
  }
  return null;
}

/**
 * Why this admin cannot approve this request, or null if they can.
 *
 * The requester can NEVER approve their own, whatever their role. That is the difference between
 * a real second pair of eyes and a formality: a compromised super_admin account would otherwise
 * simply approve itself, and the control the ticket is built around would be worth nothing.
 */
export function approvalRefusalReason(
  approverRole: AdminRole,
  approverId: string,
  requestedById: string | null,
): string | null {
  if (approverId === requestedById) {
    return "You raised this request, so you cannot approve it. A second admin must.";
  }
  if (approverRole !== "super_admin") {
    return "Refunds above the threshold need a super admin's approval.";
  }
  return null;
}

/** What a credit note does to the tenant's credit balance when it succeeds. */
export function creditBalanceDelta(type: CreditNoteType, amountCents: number): number {
  // A refund returns money to the card, so it adds nothing to a balance held against future
  // billing. Adding it to both would give the customer the same money twice.
  return type === "credit" ? amountCents : 0;
}

/**
 * Turns a credit into free days on a plan.
 *
 * Whop bills the plan price regardless, so a credit cannot reduce a charge after the fact — but
 * days the customer is not billed for are worth the same to them. Floored: giving 14 whole days
 * for a 14.7-day credit leaves a little owed, which is recoverable; rounding up gives away money
 * that is not.
 */
export function creditToFreeDays(creditCents: number, periodPriceCents: number, periodDays: number): number {
  if (periodPriceCents <= 0 || periodDays <= 0) return 0;
  const perDay = periodPriceCents / periodDays;
  return Math.floor(creditCents / perDay);
}
