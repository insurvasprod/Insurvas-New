import type { VendorScorecardRow } from "./types";

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

const dollars = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : cents / 100);

export function scorecardCsv(rows: VendorScorecardRow[]): string {
  // net_spend is the period's share of the spend (split by records received, as the comparison
  // does); lifetime_net_spend is the whole campaign. Both are exported so the split can be checked.
  const headers = ["vendor", "campaign", "product", "test_batch", "spend", "credits", "net_spend", "lifetime_net_spend", "records", "cost_per_record", "leads", "dialable", "attempts", "contacted", "contact_rate_percent", "applications", "issued_policies", "lapsed_policies", "small_sample", "effective_cost_per_issued_policy", "cost_rank"];
  const lines = rows.map((row) => [
    row.vendor_name, row.campaign_name, row.product_code, row.is_test_batch ? "yes" : "no",
    row.total_spend_cents / 100, row.credits_received_cents / 100, dollars(row.net_spend_cents), dollars(row.lifetime_net_spend_cents),
    row.records_purchased, dollars(row.cost_per_record_cents), row.leads_received, row.dialable_leads, row.attempts, row.contacted_leads,
    row.contact_rate_percent, row.applications, row.issued_policies, row.lapsed_policies, row.small_sample ? "yes" : "no",
    dollars(row.effective_cost_per_issued_policy_cents), row.cost_rank,
  ].map(csvCell).join(","));
  return [headers.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
