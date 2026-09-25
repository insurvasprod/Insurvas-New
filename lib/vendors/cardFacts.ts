import type { DropReason, VendorCardFacts, VendorCardsResponse } from "./types";

/**
 * The Vendors roster's facts, assembled from their owners' definitions. Pure: no database, no
 * server-only import, so the thresholds and the sentences can be tested on their own.
 *
 *   cost per issued policy   Scorecard   tenant_vendor_scorecard_report → vendor_rows (708200)
 *   claimable $, days left   Returns     vendor_returns_candidates_summary (707500), summed by vendor
 *   undialable share         Returns     vendor_undialable_rates (707800)
 *   certificate coverage     Scorecard   tenant_vendor_consent_coverage (708100)
 *   trialling, renewal       Vendors     tenant_vendor_card (707100)
 *
 * Nothing here recomputes a figure another definition owns. What is computed here is only the
 * comparison the user asked for (user decision 2026-09-25):
 *
 *   A vendor gets a drop-recommendation line — FACTS ONLY, it never pauses or changes anything —
 *   when its cost per policy is at least 2× the best ranked vendor's, OR its undialable share is at
 *   least 25%, OR its claimed-certificate coverage is under 50%. The line states the numbers and
 *   the renewal date. A trialling vendor is never ranked and never flagged; neither is an inactive
 *   one (it has already been dropped).
 */

export const COST_MULTIPLE = 2;
export const UNDIALABLE_AT_LEAST = 25;
export const CERTIFICATES_UNDER = 50;
export const TRIAL_LEAD_THRESHOLD = 200;

export type CardRow = { vendor_id: string; status: string; category: string | null; renews_on: string | null; campaign_count: number; lead_count: number; trial_lead_threshold: number; trialling: boolean };
export type CostRow = { vendor_id: string; vendor_name: string; net_spend_cents: number | null; issued_policies: number; cost_per_policy_cents: number | null; cost_rank: number | null; is_test_batch: boolean };
export type ClaimableRow = { vendor_id: string; claimable_cents: number; claimable_rows: number; days_left: number | null };
export type UndialableRow = { vendor_id: string; undialable_percent: number | null };
export type ConsentRow = { vendor_id: string; leads: number; claimed_coverage_pct: number | null };

type Loose = Record<string, unknown>;
const rows = (value: unknown): Loose[] => (Array.isArray(value) ? value.filter((row): row is Loose => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : []);
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

export function parseCardRows(value: unknown): CardRow[] {
  return rows(value).filter((row) => str(row.vendor_id)).map((row) => ({
    vendor_id: String(row.vendor_id),
    status: str(row.status) ?? "active",
    category: str(row.category),
    renews_on: str(row.renews_on),
    campaign_count: num(row.campaign_count) ?? 0,
    lead_count: num(row.lead_count) ?? 0,
    trial_lead_threshold: num(row.trial_lead_threshold) ?? TRIAL_LEAD_THRESHOLD,
    trialling: row.trialling === true,
  }));
}

/** Scorecard's vendor_rows, as the report returns them. Absent (not applied yet) → []. */
export function parseCostRows(value: unknown): CostRow[] {
  return rows(value).filter((row) => str(row.vendor_id)).map((row) => ({
    vendor_id: String(row.vendor_id),
    vendor_name: str(row.vendor_name) ?? "",
    net_spend_cents: num(row.net_spend_cents),
    issued_policies: num(row.issued_policies) ?? 0,
    cost_per_policy_cents: num(row.effective_cost_per_issued_policy_cents),
    cost_rank: num(row.cost_rank),
    is_test_batch: row.is_test_batch === true,
  }));
}

/**
 * Returns' summary is per campaign. Summed by vendor here — dollars and rows add, and the days
 * left is the SOONEST-closing campaign that still has something claimable (user decision).
 */
export function claimableByVendor(value: unknown): ClaimableRow[] {
  const byVendor = new Map<string, ClaimableRow>();
  for (const row of rows(value)) {
    const vendorId = str(row.vendor_id);
    const claimableRows = num(row.claimable_rows) ?? 0;
    if (!vendorId || claimableRows <= 0) continue;
    const current = byVendor.get(vendorId) ?? { vendor_id: vendorId, claimable_cents: 0, claimable_rows: 0, days_left: null };
    const days = num(row.days_left);
    current.claimable_cents += num(row.claimable_cents) ?? 0;
    current.claimable_rows += claimableRows;
    current.days_left = days === null ? current.days_left : current.days_left === null ? days : Math.min(current.days_left, days);
    byVendor.set(vendorId, current);
  }
  return [...byVendor.values()];
}

export function parseUndialableRows(value: unknown): UndialableRow[] {
  return rows(value).filter((row) => str(row.vendor_id)).map((row) => ({ vendor_id: String(row.vendor_id), undialable_percent: num(row.undialable_percent) }));
}

export function parseConsentRows(value: unknown): ConsentRow[] {
  return rows(value).filter((row) => str(row.vendor_id)).map((row) => ({ vendor_id: String(row.vendor_id), leads: num(row.leads) ?? 0, claimed_coverage_pct: num(row.claimed_coverage_pct) }));
}

export function dollars(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const pct = (value: number) => `${Number(value.toFixed(1))}%`;

/** How far one more issued policy moves cost per policy: net/n − net/(n+1), or net itself at n = 0. */
export function oneMoreSaleMoves(netSpendCents: number | null, issued: number): number | null {
  if (netSpendCents === null || netSpendCents <= 0) return null;
  if (issued <= 0) return Math.round(netSpendCents);
  return Math.round(netSpendCents / issued - netSpendCents / (issued + 1));
}

export function buildVendorCards(input: {
  vendors: Array<{ id: string; name: string; status: string }>;
  cards: CardRow[] | null;
  costs: CostRow[] | null;
  claimable: ClaimableRow[] | null;
  undialable: UndialableRow[] | null;
  consent: ConsentRow[] | null;
}): Pick<VendorCardsResponse, "cards" | "best"> {
  const card = new Map((input.cards ?? []).map((row) => [row.vendor_id, row]));
  const cost = new Map((input.costs ?? []).map((row) => [row.vendor_id, row]));
  const claim = new Map((input.claimable ?? []).map((row) => [row.vendor_id, row]));
  const undialable = new Map((input.undialable ?? []).map((row) => [row.vendor_id, row]));
  const consent = new Map((input.consent ?? []).map((row) => [row.vendor_id, row]));

  // Trialling is only known once tenant_vendor_card is applied; until then nobody is ranked, since
  // "is this vendor still on trial" is the question ranking must answer first.
  const trialling = (vendorId: string): boolean | null => (input.cards ? card.get(vendorId)?.trialling ?? false : null);
  const isRanked = (vendor: { id: string; status: string }) => {
    const row = cost.get(vendor.id);
    return vendor.status !== "inactive" && trialling(vendor.id) === false && !!row && row.cost_rank !== null && !row.is_test_batch && row.cost_per_policy_cents !== null;
  };

  let best: VendorCardsResponse["best"] = null;
  for (const vendor of input.vendors) {
    if (!isRanked(vendor)) continue;
    const row = cost.get(vendor.id)!;
    if (best === null || (row.cost_per_policy_cents as number) < best.cost_per_policy_cents)
      best = { vendor_id: vendor.id, vendor_name: vendor.name, cost_per_policy_cents: row.cost_per_policy_cents as number };
  }

  const cards = input.vendors.map((vendor): VendorCardFacts => {
    const own = card.get(vendor.id);
    const money = cost.get(vendor.id);
    const onTrial = trialling(vendor.id);
    const ranked = isRanked(vendor);
    const cpp = money?.cost_per_policy_cents ?? null;
    const undialablePct = undialable.get(vendor.id)?.undialable_percent ?? null;
    const coverage = consent.get(vendor.id);
    const certificatePct = coverage && coverage.leads > 0 ? coverage.claimed_coverage_pct : null;

    const reasons: DropReason[] = [];
    // Flagged only when the vendor's own trial status is KNOWN to be over, and it is still buying.
    const judgeable = onTrial === false && vendor.status !== "inactive";
    if (judgeable) {
      if (ranked && best && best.vendor_id !== vendor.id && cpp !== null && cpp >= COST_MULTIPLE * best.cost_per_policy_cents)
        reasons.push({ key: "cost", text: `${dollars(cpp)} per issued policy, ${Number((cpp / best.cost_per_policy_cents).toFixed(1))}× ${best.vendor_name}'s ${dollars(best.cost_per_policy_cents)}` });
      if (undialablePct !== null && undialablePct >= UNDIALABLE_AT_LEAST)
        reasons.push({ key: "undialable", text: `${pct(undialablePct)} of the records bought could never be dialed` });
      if (certificatePct !== null && certificatePct < CERTIFICATES_UNDER)
        reasons.push({ key: "certificates", text: `a claimed consent certificate for only ${pct(certificatePct)} of its leads` });
    }

    const claimable = claim.get(vendor.id);
    return {
      vendor_id: vendor.id,
      trialling: onTrial,
      campaign_count: own?.campaign_count ?? null,
      lead_count: own?.lead_count ?? null,
      trial_lead_threshold: own?.trial_lead_threshold ?? TRIAL_LEAD_THRESHOLD,
      renews_on: own?.renews_on ?? null,
      category: own?.category ?? null,
      cost_per_policy_cents: cpp,
      issued_policies: money ? money.issued_policies : null,
      net_spend_cents: money?.net_spend_cents ?? null,
      one_more_sale_moves_cents: onTrial && money ? oneMoreSaleMoves(money.net_spend_cents, money.issued_policies) : null,
      ranked,
      claimable: claimable && claimable.claimable_rows > 0 ? { cents: claimable.claimable_cents, rows: claimable.claimable_rows, days_left: claimable.days_left ?? 0 } : null,
      undialable_percent: undialablePct,
      certificate_pct: certificatePct,
      drop: reasons.length ? { reasons, renews_on: own?.renews_on ?? null } : null,
    };
  });

  return { cards, best };
}
