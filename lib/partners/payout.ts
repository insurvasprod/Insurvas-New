// Client-safe: the partner's payout terms as words and, where it can be known honestly, as money.
//
// `payoutLabel` lived in lib/partnerChat/partnerFacts.ts, which is `server-only` — so the agent
// side could say "$90.00 / transfer" and the partner it describes could not. It moves here, pure,
// and partnerFacts re-exports it; there is still one implementation.
import { formatCentsAsCurrency } from "../money.ts";
import type { PartnerPayoutModel } from "./constants.ts";

export type PartnerTerm = {
  payoutModel: PartnerPayoutModel | string;
  rateCents: number | null;
  ratePctBp: number | null;
};

const UNIT: Record<string, string> = {
  per_transfer: "transfer",
  per_lead: "lead",
  per_sale: "sale",
  per_issued_policy: "issued policy",
};

/** "$90.00 / transfer", "12.5% revenue share". Null when the term says nothing a partner can read. */
export function payoutLabel(term: { payout_model: string; rate_cents: number | null; rate_pct_bp: number | null } | null): string | null {
  if (!term) return null;
  if (term.payout_model === "revenue_share") {
    return term.rate_pct_bp == null ? null : `${(term.rate_pct_bp / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}% revenue share`;
  }
  if (term.rate_cents == null) return null;
  const unit = UNIT[term.payout_model] ?? term.payout_model.replace(/_/g, " ");
  return `${formatCentsAsCurrency(term.rate_cents)} / ${unit}`;
}

export function termLabel(term: PartnerTerm | null): string | null {
  return payoutLabel(term ? { payout_model: term.payoutModel, rate_cents: term.rateCents, rate_pct_bp: term.ratePctBp } : null);
}

/**
 * What `count` converted leads are worth, in cents.
 *
 * Only the per-item models can be answered: each converted lead is worth exactly `rateCents`, so
 * the figure is arithmetic rather than a forecast. A revenue share depends on the agency's revenue
 * per sale, which a partner cannot see, so it returns null — a plausible-looking number on a payout
 * figure is worse than no number.
 */
export function expectedEarnings(count: number, term: PartnerTerm | null): number | null {
  if (!term || term.payoutModel === "revenue_share" || term.rateCents == null) return null;
  if (!Number.isFinite(count) || count <= 0) return null;
  return Math.round(count * term.rateCents);
}

/**
 * The line under the Converted figure: "about $360.00 at $90.00 / sale".
 *
 * With nothing converted yet the rate still stands on its own — a partner who has not converted
 * anything is exactly the one who wants to know what converting is worth. With a revenue share,
 * the rate is all that can be said.
 */
export function expectedEarningsLabel(count: number, term: PartnerTerm | null): string | null {
  const rate = termLabel(term);
  if (!rate) return null;
  const cents = expectedEarnings(count, term);
  return cents === null ? rate : `about ${formatCentsAsCurrency(cents)} at ${rate}`;
}
