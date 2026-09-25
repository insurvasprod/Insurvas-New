// Client-safe and import-free on purpose: the audit-log page counts these, and node:test runs the
// predicate directly (lib/audit/logView.test.mjs).
//
// "Money actions" on /admin/audit-log (user decision): credit notes, invoice voids, manual
// payments, credit grants, the period billing run and the overage waivers. Kept out of
// lib/audit/actions.ts, which every other builder edits, so this list changes in one small file.
//
// Matched by rule rather than listed, so a new `credit_note.*` or `billing.*` action counts the
// day it is added to AUDIT_ACTIONS. The waivers are `billing.waiver_granted` / `billing.waiver_revoked`,
// so they fall under `billing.*`.
const MONEY_PREFIXES = ["credit_note.", "billing."] as const;
const MONEY_EXACT = new Set(["invoice.voided", "payment.recorded_manually", "credit_grant.created"]);

export function isMoneyAction(action: string): boolean {
  return MONEY_EXACT.has(action) || MONEY_PREFIXES.some((prefix) => action.startsWith(prefix));
}

/** The tile's hover text, so the number says what it counts. */
export const MONEY_ACTIONS_DESCRIPTION =
  "Credit notes, invoice voids, manual payments, credit grants, billing runs and overage waivers, in the last 7 days.";
