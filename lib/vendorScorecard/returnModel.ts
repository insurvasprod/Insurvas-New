/**
 * Vendor returns — the shapes the Returns page and its routes share, and the small arithmetic both
 * sides must agree on. Plain module: no server imports, so the client workspace can use it.
 *
 * SQL definitions: vendor_return_candidates / vendor_returns_candidates_summary /
 * create_combined_vendor_return_claim (20260925707500), vendor_undialable_rates (20260925707800).
 */
import type { VendorReturnClaim } from "./types";

/** Every reason a claim row can carry, from either source. */
export const CLAIM_REASONS = ["tcpa_litigator", "dnc", "invalid_phone", "duplicate_in_file", "wrong_number", "disconnected"] as const;
export type ClaimReason = (typeof CLAIM_REASONS)[number];
export function isClaimReason(value: unknown): value is ClaimReason {
  return typeof value === "string" && (CLAIM_REASONS as readonly string[]).includes(value);
}

export const REASON_LABEL: Record<ClaimReason, string> = {
  tcpa_litigator: "TCPA litigator",
  dnc: "Federal DNC",
  invalid_phone: "Invalid number",
  duplicate_in_file: "Repeat in the same file",
  wrong_number: "Wrong number",
  disconnected: "Disconnected",
};

/**
 * What the evidence CSV carries for each reason, in the words a vendor would check it by. Each line
 * names only fields the ledger really stores (lib/vendorScorecard/returnFormat.ts writes them).
 */
export function reasonEvidence(reason: ClaimReason, sources: ReadonlyArray<"lead" | "import">): string {
  const fromFile = sources.includes("import");
  const fromLead = sources.includes("lead");
  switch (reason) {
    case "dnc":
      return [fromFile && "Registry hit at import, with the line of the vendor's file", fromLead && "screening result and when it was checked"].filter(Boolean).join("; ") || "Registry screening result";
    case "tcpa_litigator":
      return "Litigator screening match, with the line of the vendor's file";
    case "invalid_phone":
      return fromFile ? "Why the number failed, with the line of the vendor's file" : "Why the number failed screening";
    case "duplicate_in_file":
      return "Each repeat of the number, with its line and occurrence";
    case "wrong_number":
    case "disconnected":
      return "Call outcome, attempt number and time (no agent name)";
  }
}

export type CandidateReasonRow = {
  reason: ClaimReason;
  source: "lead" | "import";
  claimable_rows: number;
  claimable_cents: number;
  expired_rows: number;
  expired_cents: number;
  soonest_closes_at: string | null;
};

/** One row of vendor_returns_candidates_summary: the ONE definition of claimable dollars and days left. */
export type CampaignCandidateSummary = {
  campaign_id: string;
  campaign_name: string;
  vendor_id: string;
  vendor_name: string;
  return_window_days: number;
  first_import_at: string | null;
  /** Purchased cost per record: spend / records purchased. Null when no records were entered. */
  unit_cost_cents: number | null;
  claimable_rows: number;
  claimable_cents: number;
  expired_rows: number;
  expired_cents: number;
  soonest_closes_at: string | null;
  days_left: number | null;
  reasons: CandidateReasonRow[];
};

/** One row of vendor_undialable_rates. Never blended with the claim acceptance rate. */
export type VendorUndialableRate = {
  vendor_id: string;
  vendor_name: string;
  records_purchased: number;
  removed_at_import: number;
  undialable_leads: number;
  undialable_rows: number;
  undialable_percent: number | null;
  undialable_cents: number;
};

/** One row a claim could include, as vendor_return_candidates returns it. */
export type ReturnCandidateRow = {
  source: "lead" | "import";
  lead_id: string | null;
  scrub_rejection_id: string | null;
  reason: ClaimReason;
  evidence: Record<string, unknown>;
  claimable_until: string;
  days_remaining: number;
  claimable: boolean;
};

export type VendorReturnsPageData = {
  claims: VendorReturnClaim[];
  summary: CampaignCandidateSummary[];
  /** True while 20260925707500 is not applied: the summary is today's lead-only list, priced in the app. */
  summaryFallback: boolean;
  /** Null while 20260925707800 is not applied. */
  undialable: VendorUndialableRate[] | null;
};

/**
 * The campaign's cost per issued policy over its whole life, exactly as the scorecard computes it
 * (tenant_vendor_scorecard_report — the one definition; nothing here recomputes spend).
 */
export type CampaignCostPerPolicy = { issued_policies: number; cost_per_issued_cents: number | null };

/** Per reason, both sources folded together — the preview's rows and toggles. */
export function reasonTotals(reasons: ReadonlyArray<CandidateReasonRow>) {
  const byReason = new Map<ClaimReason, { reason: ClaimReason; rows: number; cents: number; expiredRows: number; expiredCents: number; sources: Array<"lead" | "import"> }>();
  for (const row of reasons) {
    const entry = byReason.get(row.reason) ?? { reason: row.reason, rows: 0, cents: 0, expiredRows: 0, expiredCents: 0, sources: [] };
    entry.rows += row.claimable_rows;
    entry.cents += row.claimable_cents;
    entry.expiredRows += row.expired_rows;
    entry.expiredCents += row.expired_cents;
    if ((row.claimable_rows > 0 || row.expired_rows > 0) && !entry.sources.includes(row.source)) entry.sources.push(row.source);
    byReason.set(row.reason, entry);
  }
  return CLAIM_REASONS.map((reason) => byReason.get(reason)).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

/**
 * What the draft will ask for with these reasons on: rows x the purchased rate, rounded ONCE — the
 * arithmetic create_combined_vendor_return_claim uses, so the preview and the claim agree.
 */
export function claimAmountCents(rows: number, unitCostCents: number | null): number | null {
  if (unitCostCents == null) return null;
  return Math.round(rows * unitCostCents);
}

/**
 * Cost per issued policy once a credit of `creditCents` lands on the campaign's spend: the
 * scorecard's own figure less the credit spread over the same issued policies. Null when nothing
 * has been issued — there is no cost per policy to move.
 */
export function costPerIssuedAfterCredit(cost: CampaignCostPerPolicy, creditCents: number): number | null {
  if (!cost.issued_policies || cost.cost_per_issued_cents == null) return null;
  return Math.max(0, cost.cost_per_issued_cents * cost.issued_policies - creditCents) / cost.issued_policies;
}

/** Before a credit that has already landed: the same arithmetic, the other way. */
export function costPerIssuedBeforeCredit(cost: CampaignCostPerPolicy, creditCents: number): number | null {
  if (!cost.issued_policies || cost.cost_per_issued_cents == null) return null;
  return (cost.cost_per_issued_cents * cost.issued_policies + creditCents) / cost.issued_policies;
}

/** Whole days until an instant, floored. Kept for callers that want elapsed time; the countdown uses calendarDaysLeft. */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((Date.parse(iso) - now) / 86_400_000));
}

/** "YYYY-MM-DD" of an instant on the wall calendar of `zone` (an IANA name). An unknown zone reads as UTC. */
export function zonedDay(at: string | number | Date, zone: string | null | undefined): string {
  const date = at instanceof Date ? at : new Date(at);
  const format = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  try {
    return format(zone || "UTC");
  } catch {
    return format("UTC");
  }
}

/**
 * Days left on a return window as CALENDAR days in the tenant's zone (LA-2.19-2): a window that
 * closes at 15:21 tomorrow has one day left, not "closes today" because fewer than 24 hours remain.
 * 0 means it closes today; never negative. The same arithmetic the SQL uses after 20260925709810:
 * (closes_at in zone)::date - (now in zone)::date.
 */
export function calendarDaysLeft(iso: string, zone: string | null | undefined, now: Date = new Date()): number {
  const closes = Date.parse(`${zonedDay(iso, zone)}T00:00:00Z`);
  const today = Date.parse(`${zonedDay(now, zone)}T00:00:00Z`);
  if (!Number.isFinite(closes) || !Number.isFinite(today)) return 0;
  return Math.max(0, Math.round((closes - today) / 86_400_000));
}

/** "Closes today", "Closes tomorrow", "5 days left"; "Window closed" for none. */
export function closesLabel(days: number | null): string {
  if (days === null) return "Window closed";
  if (days === 0) return "Closes today";
  if (days === 1) return "Closes tomorrow";
  return `${days} days left`;
}
