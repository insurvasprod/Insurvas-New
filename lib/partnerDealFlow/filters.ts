import type { PartnerDealFlowFilters, PartnerDealFlowRow } from "./types.ts";

export const NO_CARRIER_FILTER = "__no_carrier__";

/** Keep the list filters field-specific while sharing the same row predicate with the CSV path. */
export function matchesPartnerDealFlowFilters(row: PartnerDealFlowRow, filters: PartnerDealFlowFilters): boolean {
  if (filters.annualisedPremiumMinCents != null && filters.annualisedPremiumMaxCents != null && filters.annualisedPremiumMinCents > filters.annualisedPremiumMaxCents) return false;
  if (filters.draftDateFrom && filters.draftDateTo && filters.draftDateFrom > filters.draftDateTo) return false;

  const customer = filters.customer?.trim().toLowerCase();
  if (customer && !row.customer.toLowerCase().includes(customer)) return false;

  if (filters.carrier === NO_CARRIER_FILTER && row.carrier !== null) return false;
  if (filters.carrier && filters.carrier !== NO_CARRIER_FILTER && row.carrier !== filters.carrier) return false;

  const annualisedPremium = row.monthlyPremiumCents === null ? null : row.monthlyPremiumCents * 12;
  if (filters.annualisedPremiumMinCents != null && (annualisedPremium === null || annualisedPremium < filters.annualisedPremiumMinCents)) return false;
  if (filters.annualisedPremiumMaxCents != null && (annualisedPremium === null || annualisedPremium > filters.annualisedPremiumMaxCents)) return false;

  if (filters.draftDateFrom && (!row.draftDate || row.draftDate < filters.draftDateFrom)) return false;
  if (filters.draftDateTo && (!row.draftDate || row.draftDate > filters.draftDateTo)) return false;

  return true;
}
