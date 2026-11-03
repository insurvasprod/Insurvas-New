import type { VendorScorecardReport, VendorScorecardRow, VendorScorecardTotals, VendorScorecardVendorRow } from "./types";

/**
 * Turns what tenant_vendor_scorecard_report returned, plus vendor_return_metrics' per-campaign
 * extras, into the one report shape the page and /app/vendors read.
 *
 * Plain module (no server-only) so node:test runs it directly. Two report generations arrive here:
 *
 *   upgraded   20260925708200 applied: spend split by records received, vendor_rows, ranks, test
 *              batches, persistency. Taken as given — every figure is the SQL's.
 *   old        20260913420000 only: lifetime spend, no vendor roll-up. Filled so the page renders
 *              what it has; nothing is invented that the SQL did not compute, except the rank and
 *              small-sample flag, which are pure functions of figures the old report does return.
 */

export const SMALL_SAMPLE_BELOW_DEFAULT = 5;

type Loose = Record<string, unknown>;

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}
function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = num(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}
function round2(value: number) { return Math.round(value * 100) / 100; }
function ratio(part: number | null, whole: number): number | null {
  return part === null || !whole ? null : round2(part / whole);
}

export type ReturnMetrics = Map<string, Loose>;

/** Rank 1 = cheapest policy, over rows that have a cost per issued policy and are not a test batch. Ties share a rank. */
export function rankByCostPerIssued<T extends { is_test_batch: boolean; effective_cost_per_issued_policy_cents: number | null }>(rows: T[]): Map<T, number> {
  const ranked = rows.filter((row) => !row.is_test_batch && row.effective_cost_per_issued_policy_cents !== null)
    .sort((a, b) => (a.effective_cost_per_issued_policy_cents as number) - (b.effective_cost_per_issued_policy_cents as number));
  const ranks = new Map<T, number>();
  ranked.forEach((row, index) => {
    const previous = index ? ranked[index - 1] : null;
    ranks.set(row, previous && previous.effective_cost_per_issued_policy_cents === row.effective_cost_per_issued_policy_cents ? ranks.get(previous) as number : index + 1);
  });
  return ranks;
}

/**
 * Net spend ÷ contacted leads. The report computes it since 20260925709800; before, it is a pure
 * function of two figures the old report returns, filled here like the rank. Null with no contacts
 * or no splittable spend: a dash, never $0.
 */
function costPerContact(raw: Loose): number | null {
  if (raw.effective_cost_per_contact_cents !== undefined) return nullableNum(raw.effective_cost_per_contact_cents);
  const spend = nullableNum(raw.net_spend_cents);
  const contacted = num(raw.contacted_leads);
  return spend === null || !contacted ? null : round2(spend / contacted);
}

/** A funnel count only the 20260925709800 report returns. Null before it, never a guessed zero. */
function funnelCount(raw: Loose, key: string): number | null {
  return raw[key] === undefined ? null : num(raw[key]);
}

function campaignRow(raw: Loose, extra: Loose, upgraded: boolean, smallBelow: number): VendorScorecardRow {
  const leads = num(raw.leads_received);
  const issued = num(raw.issued_policies);
  const total = num(raw.total_spend_cents);
  const records = num(raw.records_purchased);
  const credits = num(raw.credits_received_cents);
  // Since 20260925709800 the report carries the undialable and claim figures itself, by
  // vendor_return_metrics' own definitions; before it they come from that RPC beside the report.
  if (raw.undialable_leads !== undefined) extra = raw;
  const undialable = num(extra.undialable_leads);
  return {
    campaign_id: String(raw.campaign_id),
    vendor_id: String(raw.vendor_id),
    vendor_name: String(raw.vendor_name ?? ""),
    campaign_name: String(raw.campaign_name ?? ""),
    product_code: raw.product_code == null ? null : String(raw.product_code),
    total_spend_cents: total,
    records_purchased: records,
    credits_received_cents: credits,
    net_spend_cents: nullableNum(raw.net_spend_cents),
    lifetime_net_spend_cents: upgraded ? num(raw.lifetime_net_spend_cents, total - credits) : total - credits,
    cost_per_record_cents: raw.cost_per_record_cents !== undefined ? (nullableNum(raw.cost_per_record_cents) === null ? null : round2(nullableNum(raw.cost_per_record_cents) as number)) : ratio(total, records),
    leads_received: leads,
    attempts: num(raw.attempts),
    contacted_leads: num(raw.contacted_leads),
    dialed_leads: funnelCount(raw, "dialed_leads"),
    quoted_leads: funnelCount(raw, "quoted_leads"),
    applied_leads: funnelCount(raw, "applied_leads"),
    effective_cost_per_contact_cents: costPerContact(raw),
    applications: num(raw.applications),
    issued_policies: issued,
    lapsed_policies: num(raw.lapsed_policies),
    policies_not_yet_measurable: num(raw.policies_not_yet_measurable),
    attribution_warnings: num(raw.attribution_warnings),
    effective_cost_per_lead_cents: nullableNum(raw.effective_cost_per_lead_cents),
    effective_cost_per_application_cents: nullableNum(raw.effective_cost_per_application_cents),
    effective_cost_per_issued_policy_cents: nullableNum(raw.effective_cost_per_issued_policy_cents),
    contact_rate_percent: nullableNum(raw.contact_rate_percent),
    is_test_batch: raw.is_test_batch === true,
    small_sample: typeof raw.small_sample === "boolean" ? raw.small_sample : issued >= 1 && issued < smallBelow,
    cost_rank: nullableNum(raw.cost_rank),
    undialable_leads: undialable,
    undialable_rate_percent: nullableNum(extra.undialable_rate_percent),
    dialable_leads: Math.max(0, leads - undialable),
    claim_count: num(extra.claim_count),
    amount_claimed_cents: num(extra.amount_claimed_cents),
    amount_credited_cents: num(extra.amount_credited_cents),
    claim_acceptance_rate_percent: nullableNum(extra.claim_acceptance_rate_percent),
  };
}

function vendorRow(raw: Loose, campaigns: VendorScorecardRow[]): VendorScorecardVendorRow {
  const vendorId = String(raw.vendor_id);
  const isTest = raw.is_test_batch === true;
  // The same basis the SQL rolled the vendor up over: its committed campaigns, or all of them when
  // every one is a test batch.
  const basis = campaigns.filter((row) => row.vendor_id === vendorId && row.is_test_batch === isTest);
  const leads = num(raw.leads_received);
  const undialable = basis.reduce((sum, row) => sum + row.undialable_leads, 0);
  const claimed = basis.reduce((sum, row) => sum + row.amount_claimed_cents, 0);
  const credited = basis.reduce((sum, row) => sum + row.amount_credited_cents, 0);
  return {
    vendor_id: vendorId,
    vendor_name: String(raw.vendor_name ?? ""),
    is_test_batch: isTest,
    campaigns: num(raw.campaigns),
    test_batch_campaigns: num(raw.test_batch_campaigns),
    total_spend_cents: num(raw.total_spend_cents),
    records_purchased: num(raw.records_purchased),
    credits_received_cents: num(raw.credits_received_cents),
    lifetime_net_spend_cents: num(raw.lifetime_net_spend_cents),
    net_spend_cents: nullableNum(raw.net_spend_cents),
    cost_per_record_cents: nullableNum(raw.cost_per_record_cents),
    leads_received: leads,
    attempts: num(raw.attempts),
    contacted_leads: num(raw.contacted_leads),
    dialed_leads: funnelCount(raw, "dialed_leads"),
    quoted_leads: funnelCount(raw, "quoted_leads"),
    applied_leads: funnelCount(raw, "applied_leads"),
    effective_cost_per_contact_cents: costPerContact(raw),
    applications: num(raw.applications),
    issued_policies: num(raw.issued_policies),
    lapsed_policies: num(raw.lapsed_policies),
    policies_not_yet_measurable: num(raw.policies_not_yet_measurable),
    attribution_warnings: num(raw.attribution_warnings),
    effective_cost_per_lead_cents: nullableNum(raw.effective_cost_per_lead_cents),
    effective_cost_per_application_cents: nullableNum(raw.effective_cost_per_application_cents),
    effective_cost_per_issued_policy_cents: nullableNum(raw.effective_cost_per_issued_policy_cents),
    contact_rate_percent: nullableNum(raw.contact_rate_percent),
    small_sample: raw.small_sample === true,
    cost_rank: nullableNum(raw.cost_rank),
    speed_posted_leads: nullableNum(raw.speed_posted_leads),
    speed_dialled_leads: nullableNum(raw.speed_dialled_leads),
    speed_median_seconds: nullableNum(raw.speed_median_seconds),
    speed_within_60s_pct: nullableNum(raw.speed_within_60s_pct),
    consent_leads: nullableNum(raw.consent_leads),
    consent_claimed_leads: nullableNum(raw.consent_claimed_leads),
    consent_claimed_pct: nullableNum(raw.consent_claimed_pct),
    consent_any_pct: nullableNum(raw.consent_any_pct),
    undialable_leads: undialable,
    undialable_rate_percent: leads ? Number((100 * undialable / leads).toFixed(2)) : null,
    dialable_leads: Math.max(0, leads - undialable),
    amount_claimed_cents: claimed,
    amount_credited_cents: credited,
    claim_acceptance_rate_percent: claimed ? Number((100 * credited / claimed).toFixed(2)) : null,
  };
}

export function normalizeScorecard(value: unknown, metrics: ReturnMetrics, readOnly: boolean, upgraded: boolean): VendorScorecardReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The vendor scorecard was invalid");
  const report = value as Loose;
  if (!Array.isArray(report.rows) || !report.totals || typeof report.totals !== "object") throw new Error("The vendor scorecard was incomplete");
  const smallBelow = num(report.small_sample_below, SMALL_SAMPLE_BELOW_DEFAULT);
  const rows = (report.rows as Loose[]).map((raw) => campaignRow(raw, metrics.get(String(raw.campaign_id)) ?? {}, upgraded, smallBelow));
  if (!upgraded) {
    // The old report has no rank; derive it from its own figures so the order and tint still work.
    const ranks = rankByCostPerIssued(rows);
    for (const row of rows) row.cost_rank = ranks.get(row) ?? null;
  }
  const vendorRows = upgraded && Array.isArray(report.vendor_rows) ? (report.vendor_rows as Loose[]).map((raw) => vendorRow(raw, rows)) : [];

  const t = report.totals as Loose;
  const leads = num(t.leads_received);
  const undialable = rows.reduce((sum, row) => sum + row.undialable_leads, 0);
  const claimed = rows.reduce((sum, row) => sum + row.amount_claimed_cents, 0);
  const credited = rows.reduce((sum, row) => sum + row.amount_credited_cents, 0);
  const totals: VendorScorecardTotals = {
    campaigns: num(t.campaigns, rows.length),
    test_batch_campaigns: num(t.test_batch_campaigns),
    unallocated_spend_campaigns: num(t.unallocated_spend_campaigns),
    net_spend_cents: num(t.net_spend_cents),
    lifetime_net_spend_cents: upgraded ? num(t.lifetime_net_spend_cents) : num(t.net_spend_cents),
    total_spend_cents: num(t.total_spend_cents),
    credits_received_cents: num(t.credits_received_cents),
    records_purchased: num(t.records_purchased),
    leads_received: leads,
    attempts: num(t.attempts),
    contacted_leads: num(t.contacted_leads),
    dialed_leads: funnelCount(t, "dialed_leads"),
    quoted_leads: funnelCount(t, "quoted_leads"),
    applied_leads: funnelCount(t, "applied_leads"),
    effective_cost_per_contact_cents: costPerContact(t),
    applications: num(t.applications),
    issued_policies: num(t.issued_policies),
    lapsed_policies: num(t.lapsed_policies),
    policies_not_yet_measurable: num(t.policies_not_yet_measurable),
    attribution_warnings: num(t.attribution_warnings),
    effective_cost_per_lead_cents: nullableNum(t.effective_cost_per_lead_cents),
    effective_cost_per_application_cents: nullableNum(t.effective_cost_per_application_cents),
    effective_cost_per_issued_policy_cents: nullableNum(t.effective_cost_per_issued_policy_cents),
    contact_rate_percent: nullableNum(t.contact_rate_percent),
    undialable_leads: undialable,
    undialable_rate_percent: leads ? Number((100 * undialable / leads).toFixed(2)) : null,
    dialable_leads: Math.max(0, leads - undialable),
    claim_count: rows.reduce((sum, row) => sum + row.claim_count, 0),
    amount_claimed_cents: claimed,
    amount_credited_cents: credited,
    claim_acceptance_rate_percent: claimed ? Number((100 * credited / claimed).toFixed(2)) : null,
  };

  const attempts = Array.isArray(report.attempts_to_contact) ? (report.attempts_to_contact as Loose[]) : [];
  const allContacts = attempts.reduce((sum, item) => sum + num(item.contacts), 0);
  const filters = (report.filters && typeof report.filters === "object" ? report.filters : {}) as Loose;
  return {
    from: String(report.from),
    to: String(report.to),
    generated_at: String(report.generated_at),
    live: true,
    snapshot: false,
    persist_days: upgraded ? nullableNum(report.persist_days) : null,
    small_sample_below: smallBelow,
    totals,
    rows,
    vendor_rows: vendorRows,
    contact_rate_by_slot: (Array.isArray(report.contact_rate_by_slot) ? (report.contact_rate_by_slot as Loose[]) : []).map((item) => ({ slot: String(item.slot), attempts: num(item.attempts), contacts: num(item.contacts), rate_percent: nullableNum(item.rate_percent) })),
    attempts_to_contact: attempts.map((item) => ({
      attempt_number: num(item.attempt_number),
      attempts: num(item.attempts),
      contacts: num(item.contacts),
      rate_percent: nullableNum(item.rate_percent),
      // A share of all contacts is a pure function of the contact counts the old report returns.
      share_of_contacts_percent: item.share_of_contacts_percent !== undefined ? nullableNum(item.share_of_contacts_percent) : allContacts ? round2(100 * num(item.contacts) / allContacts) : null,
    })),
    filters: { vendor_id: (filters.vendor_id as string | null) ?? null, campaign_id: (filters.campaign_id as string | null) ?? null, product_code: (filters.product_code as string | null) ?? null },
    readOnly,
    upgraded,
    funnel: upgraded && num(report.funnel_version) >= 2,
  };
}
