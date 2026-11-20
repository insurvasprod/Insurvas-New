/**
 * A statement line for a policy the book holds from a CARRIER FILE (owner 2026-11-19, "fix matching").
 *
 * Statement lines match tenant_policies — the policies typed in or imported by hand (Ledger's book). A Basic or
 * Advanced agency's book arrives in carrier files instead (policy_current), so its statement lines all read "No
 * policy … in your book". When a line's policy number is not among the hand policies but the carrier's own file
 * lists it, the import writes a MIRROR row in tenant_policies (source "carrier_file", 20261120100000) built from
 * the carrier's latest values, and the line is matched to it exactly as any other.
 *
 * The mirror is bookkeeping, not a second policy:
 *   · the Policies list, the book export, search and the rate card leave it out — the carrier row already shows;
 *   · the statement check (refreshDiscrepancies) judges it, from the rate card, like a hand policy;
 *   · the carrier-file check (runDetection) skips it, so one policy is never both "never paid" and "paid short".
 *
 * Pure: the server half is in statementService (carrierPolicyMirrors).
 */

import { computeLedger, type LedgerLibrary, type LedgerPolicy } from "./compute.ts";

export const MIRROR_SOURCE = "carrier_file";

/**
 * What a mirrored policy's first year should pay by the RATE CARD, as an expected_commission row for the carrier
 * policy's Money tab (owner 2026-11-20: Expected read "—" while Pay issues already knew $382.50 was due). The
 * carrier-file engine prices a policy only once Carrier terms set its pay trigger; the statement check prices it
 * from the rate card, so the tab shows the figure that check uses. Year one in full: the advance plus its balance.
 */
export function mirrorExpectedRows(policy: LedgerPolicy, library: LedgerLibrary): Array<Record<string, unknown>> {
  const { entries, gaps } = computeLedger([policy], library, "9999-12-31");
  const yearOne = entries.filter((entry) => entry.policyYear === 1 && entry.kind !== "chargeback");
  if (!yearOne.length) return gaps[0] ? [{ policy_year: 1, confidence: "no_rate_card", reason: gaps[0].reason, expected_amount_cents: null }] : [];
  const advance = yearOne.find((entry) => entry.kind === "advance");
  const rule = advance?.advanceRuleId ? library.advanceRules.find((row) => row.id === advance.advanceRuleId) : undefined;
  return [{
    policy_year: 1, confidence: "rate_card", expected_amount_cents: yearOne.reduce((sum, entry) => sum + entry.amountCents, 0),
    rate_bp_applied: yearOne[0].rateBp, advance_pct_bp: rule?.advance_pct_bp ?? null, advance_months: rule?.advance_months ?? null, commission_trigger: "on_issue",
  }];
}

export type CarrierCurrent = {
  policy_number: string;
  status_normalized: string | null;
  issue_date: string | null;
  effective_date: string | null;
  annualised_premium_cents: number | string | null;
  product_code: string | null;
  agent_user_id: string | null;
};

export type MirrorRow = {
  policy_number: string;
  insured_name: string;
  carrier: string;
  product: string;
  effective_date: string | null;
  annual_premium_cents: number | null;
  status: "active" | "pending" | "lapsed" | "cancelled";
  source: typeof MIRROR_SOURCE;
};

/** The carrier's normalised status as a hand policy's four (active, pending, lapsed, cancelled). */
export function mirrorStatus(status: string | null | undefined): MirrorRow["status"] {
  const s = String(status ?? "").toLowerCase();
  if (["lapsed", "terminated", "surrendered", "expired"].includes(s)) return "lapsed";
  if (["cancelled", "canceled", "declined", "not_taken", "withdrawn", "rescinded"].includes(s)) return "cancelled";
  if (["pending", "submitted", "approved_unpaid", "issued_unpaid", "incomplete"].includes(s)) return "pending";
  return "active";
}

/**
 * The mirror for one carrier policy. `insuredName` comes from the statement line (policy_current keeps the client
 * as a link, not a name); `productName` is the product family the carrier's code is matched to, else the code.
 */
export function mirrorRow(current: CarrierCurrent, input: { carrierName: string; insuredName: string | null; productName: string | null }): MirrorRow {
  const premium = current.annualised_premium_cents === null || current.annualised_premium_cents === undefined ? null : Math.round(Number(current.annualised_premium_cents));
  return {
    policy_number: current.policy_number.slice(0, 120),
    insured_name: (input.insuredName?.trim() || "Named in the carrier file").slice(0, 200),
    carrier: input.carrierName,
    product: (input.productName ?? current.product_code ?? "Unknown product").slice(0, 120),
    effective_date: current.issue_date ?? current.effective_date ?? null,
    annual_premium_cents: premium !== null && Number.isFinite(premium) ? premium : null,
    status: mirrorStatus(current.status_normalized),
    source: MIRROR_SOURCE,
  };
}

/** The policy numbers a statement names that the hand book does not hold, normalised the way matching compares them. */
export function numbersToMirror(lines: ReadonlyArray<{ policyNumber: string | null; error: string | null }>, held: ReadonlyArray<string>, normalise: (n: string) => string): string[] {
  const have = new Set(held.map(normalise));
  const out = new Map<string, string>();
  for (const line of lines) {
    if (line.error || !line.policyNumber) continue;
    const key = normalise(line.policyNumber);
    if (!key || have.has(key) || out.has(key)) continue;
    out.set(key, line.policyNumber.trim());
  }
  return [...out.values()];
}
