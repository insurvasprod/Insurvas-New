// Shared with the client component: plain values and types only, never server code.
//
// Daily deal flow, the partner's side (plan tasks/partner-daily-deal-flow). One day of what the
// agency did with the leads this partner sent. Read-only.

import type { DealFlowStageType } from "../dealFlow/types.ts";

export { DEAL_FLOW_STAGE_TYPES, STAGE_TYPE_LABEL, type DealFlowStageType } from "../dealFlow/types.ts";

/**
 * Every `deal_flow` column the partner API may read, as a literal list.
 *
 * This is the leak boundary, and it is a list rather than a habit so that a test can hold it. The
 * table also carries `notes`, `worked_by`, `buffer_agent`, `campaign_id`, `vendor_id`, `source`,
 * `disposition_by`, `tracking_id`, `submission_id`, `manual_entry`, `phone` and `initial_quote`:
 * who at the agency worked a lead, and where the agency got it, is agency business, not the
 * partner's. Add a column here only on purpose.
 */
export const PARTNER_DEAL_FLOW_COLUMNS = [
  "lead_id",
  "product_line",
  "insured_name",
  "local_date",
  "call_result",
  "carrier",
  "product_type",
  "monthly_premium_cents",
  "face_amount_cents",
  "disposition_at",
  "updated_at",
] as const;

/**
 * The lead columns that ride along. `created_by` is the scope (lib/partnerLeads/scope.ts),
 * `created_at` dates the submission, `stage_id` is the lead's CURRENT stage — the same stage
 * Pipeline shows, so the two pages can never disagree about where a lead stands.
 *
 * `values` is deliberately absent: the customer's name comes from `deal_flow.insured_name`, so
 * this page never opens the lead's value bag and there is nothing on it for `maskSensitiveValues`
 * to have to catch.
 */
export const PARTNER_DEAL_FLOW_LEAD_COLUMNS = ["created_by", "created_at", "stage_id"] as const;

/**
 * Who this request may see, resolved from the signed session before the service is called.
 *
 * Ids rather than a role, deliberately. The portal's own rule is `lib/partnerLeads/scope.ts`', and
 * under it a `partner_admin` sees the whole organisation — on Pipeline, the lead record, the CSV
 * export, Overview and Team review, where it is unchanged. This page alone narrows an admin to
 * their team (owner, 2 Nov), and it does so by being handed a list rather than by re-deciding from
 * the role: a second opinion about who an admin is would drift from `scope.ts` the day after it
 * was written. `lib/partnerAuth/team.ts` works out the list; this is the shape it travels in.
 */
export type PartnerDealFlowAccess = {
  /**
   * The `agent_leads.created_by` ids this viewer may read. **Never empty** — it always holds the
   * viewer themselves. An empty list would filter to nothing, or tempt the next reader of the
   * query into treating it as "no filter"; the service throws rather than accept one.
   */
  visibleIds: readonly string[];
};

export type PartnerDealFlowRow = {
  leadId: string;
  /** The deal's own local day. One range can hold several, so the row carries it, not the page. */
  day: string;
  customer: string;
  productLine: string;
  stageName: string;
  stageType: DealFlowStageType;
  carrier: string | null;
  productType: string | null;
  monthlyPremiumCents: number | null;
  faceAmountCents: number | null;
  /** The lead's creation day in the partner's timezone (shown under the legacy "Draft date" heading). */
  draftDate: string | null;
  /** The partner-facing outcome label, as the Pipeline words it. */
  outcome: string | null;
  submittedBy: { id: string | null; name: string };
  /** The submission's day in the partner's timezone — how old the lead was when it was worked. */
  submittedDay: string;
  updatedAt: string;
};

export type PartnerDealFlowFigures = {
  worked: number;
  won: number;
  inProgress: number;
  lost: number;
  /** Summed over won deals that carry a premium; `wonUnpriced` counts those that do not. */
  wonMonthlyCents: number;
  wonAnnualisedCents: number;
  wonUnpriced: number;
  /** Days between the oldest still-open deal's submission and the day on screen. Null when none. */
  oldestInProgressDays: number | null;
  /** The commonest outcome among the day's lost deals, already labelled. Null when none. */
  topLostReason: string | null;
};

export type PartnerDealFlowFilters = {
  stageType?: DealFlowStageType | null;
  product?: string | null;
  submittedBy?: string | null;
  search?: string | null;
  customer?: string | null;
  carrier?: string | null;
  annualisedPremiumMinCents?: number | null;
  annualisedPremiumMaxCents?: number | null;
  draftDateFrom?: string | null;
  draftDateTo?: string | null;
};

export type PartnerDealFlowPayload = {
  /** The range on screen, YYYY-MM-DD in the partner organisation's timezone. Both inclusive. */
  from: string;
  to: string;
  /** Today in that same timezone: the default range, and the ceiling on the date inputs. */
  today: string;
  rows: PartnerDealFlowRow[];
  figures: PartnerDealFlowFigures;
  /**
   * How many rows each stage chip holds, counted before the stage filter is applied — so a chip
   * reading "Won 4" still reads "Won 4" once it is pressed.
   */
  stageCounts: Record<DealFlowStageType, number>;
  facets: {
    products: string[];
    carriers: Array<string | null>;
    submitters: Array<{ id: string; name: string }>;
  };
  /**
   * The day held more deals than one read returns, so the figures describe only what was read.
   * It cannot happen with anything like real volume; it is here because silently wrong figures on
   * a card are the one failure on this page nobody would report.
   */
  capped: boolean;
  generatedAt: string;
};
