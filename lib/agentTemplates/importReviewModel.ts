/**
 * List import · the shapes and arithmetic both import screens and the server share.
 *
 * A plain module on purpose: `importPreflight.ts` is server-only, and the review screen is a client
 * component. Anything the two must agree on — the buckets, the money bounds, how a footer adds up —
 * lives here, so neither side can drift from the other.
 */

/** Where the upload screen leaves the file for the review screen, suffixed with the batch id. */
export const IMPORT_CSV_KEY = "insurvas.import.csv";

/** Every bucket the review screen can list, in the order it lists them. */
export type ReviewBucket =
  | "ready"
  | "duplicate_existing"
  | "duplicate_in_file"
  | "dnc_tenant"
  | "dnc_registry"
  /** Plans staged before the DNC source was recorded carry their hits here. */
  | "dnc"
  | "litigator"
  | "invalid_phone"
  | "unreadable";

export const REVIEW_BUCKETS: ReviewBucket[] = [
  "ready",
  "duplicate_existing",
  "duplicate_in_file",
  "dnc_tenant",
  "dnc_registry",
  "dnc",
  "litigator",
  "invalid_phone",
  "unreadable",
];

export type BucketCounts = Record<ReviewBucket, number>;
export type BucketRows = Partial<Record<ReviewBucket, number[]>>;

/**
 * A do-not-call row can still end up new, attached or repeated when it is imported and suppressed,
 * so the plan records which. Without it the footer would guess.
 */
export type DncBreakdown = { new: number; existing: number; repeat: number };

export const EMPTY_BUCKETS: BucketCounts = {
  ready: 0, duplicate_existing: 0, duplicate_in_file: 0, dnc_tenant: 0, dnc_registry: 0, dnc: 0,
  litigator: 0, invalid_phone: 0, unreadable: 0,
};

export type ReviewDecisions = {
  duplicatesInFile: "first" | "skip";
  existingLeads: "attach" | "skip";
  dnc: "exclude" | "suppress";
};

/**
 * What the commit will do with every row, given the choices.
 *
 * `leftOut` is added up from the buckets rather than taken as a remainder, so `new + added +
 * leftOut === totalRows` is a real check the screen can show — not a sum true by construction.
 */
export function reviewOutcome(counts: BucketCounts, dnc: DncBreakdown, decisions: ReviewDecisions) {
  const dncRows = counts.dnc_tenant + counts.dnc_registry + counts.dnc;
  const suppress = decisions.dnc === "suppress";
  const attach = decisions.existingLeads === "attach";
  const fresh = counts.ready + (suppress ? dnc.new : 0);
  const added = attach ? counts.duplicate_existing + (suppress ? dnc.existing : 0) : 0;
  const leftOut =
    counts.duplicate_in_file
    + counts.litigator
    + counts.invalid_phone
    + counts.unreadable
    + (suppress ? dnc.repeat : dncRows)
    + (attach ? 0 : counts.duplicate_existing + (suppress ? dnc.existing : 0));
  /** Rows that become or stay a lead and are not suppressed: new leads plus people you already have. */
  const dialable = counts.ready + (attach ? counts.duplicate_existing : 0);
  return { fresh, added, leftOut, willImport: fresh + added, dialable, suppressedImports: suppress ? dnc.new + (attach ? dnc.existing : 0) : 0 };
}

/* ── money ──────────────────────────────────────────────────────────────────────────────────── */

/** $1,000,000 — one file. Matches agent_lead_import_batches_cost_cents_check and the import RPC. */
export const MAX_BATCH_COST_CENTS = 100_000_000;
/** Matches agent_lead_import_batches_records_purchased_check and the import RPC. */
export const MAX_RECORDS_PURCHASED = 10_000_000;

/**
 * Dollars and cents as typed ("4,500", "$4,500.00", "12.5") to integer cents.
 *
 * `null` for an empty field — no cost entered — and `"invalid"` for anything that is not a
 * non-negative amount with at most two decimals, or is above the cap. Never a float: the amount is
 * split on the decimal point and assembled in integers, so "0.29" is 29 cents and not 28.999….
 */
export function parseDollarsToCents(raw: string): number | null | "invalid" {
  const value = raw.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  if (!value) return null;
  const match = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(value) ?? /^()\.(\d{1,2})$/.exec(value);
  if (!match) return "invalid";
  const dollars = match[1] ? Number(match[1]) : 0;
  const cents = Number((match[2] ?? "").padEnd(2, "0") || "0");
  const total = dollars * 100 + cents;
  if (!Number.isSafeInteger(total) || total < 0 || total > MAX_BATCH_COST_CENTS) return "invalid";
  return total;
}

/** A whole, non-negative row count, or `"invalid"`. Empty is `null`. */
export function parseRecordCount(raw: string): number | null | "invalid" {
  const value = raw.trim().replace(/,/g, "");
  if (!value) return null;
  if (!/^\d{1,8}$/.test(value)) return "invalid";
  const count = Number(value);
  return count > MAX_RECORDS_PURCHASED ? "invalid" : count;
}

export function formatCents(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Cost divided by a count, in cents, or null when there is nothing to divide by. */
export function perUnitCents(costCents: number | null, units: number) {
  if (costCents === null || units <= 0) return null;
  return costCents / units;
}

/* ── cost per usable record ─────────────────────────────────────────────────────────────────── */

/**
 * The cost per usable record this file's leads should carry, counting this file's own rejections
 * BEFORE they are written — they now land in the same transaction as the leads, so the campaign's
 * cost view cannot be read after them. The same arithmetic as tenant_campaign_costs:
 * (spend − credits) ÷ (purchased − rejected), falling back to the purchased basis when no usable
 * record is left. A rejection the ledger already holds is counted twice here, which errs towards a
 * HIGHER cost per lead, the safe direction (LA-2.17).
 */
export function projectedUsableCostCents(
  campaign: {
    total_spend_cents?: number | null;
    credits_received_cents?: number | null;
    records_purchased?: number | null;
    records_rejected?: number | null;
    cost_per_record_cents?: number | null;
    cost_per_usable_record_cents?: number | null;
  },
  newRejections: number,
): number {
  const spend = Number(campaign.total_spend_cents ?? NaN) - Number(campaign.credits_received_cents ?? 0);
  const usable = Number(campaign.records_purchased ?? NaN) - Number(campaign.records_rejected ?? 0) - newRejections;
  if (Number.isFinite(spend) && Number.isFinite(usable))
    return Math.max(0, Math.round(usable > 0 ? spend / usable : Number(campaign.cost_per_record_cents ?? 0)));
  return Math.max(0, Math.round(Number(campaign.cost_per_usable_record_cents ?? campaign.cost_per_record_cents ?? 0)));
}
