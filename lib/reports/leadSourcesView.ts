/**
 * Reports › Lead sources (owner 2026-11-19: Basic buys and imports leads but had no report on them). What each
 * vendor's and campaign's leads became in the period: received, dialed, contacted, applied, issued, with the speed to
 * the first dial and the consent on file. A plain module (no React, no "use client", no server-only import), so the
 * server page, the view and node:test share it.
 *
 * The figures are tenant_vendor_scorecard_report's (lib/vendorScorecard/service.ts), the one report True CPA reads,
 * so the two never disagree. Money (net spend, cost per lead) shows only with True CPA on the plan, as on a campaign's
 * page ("what a list cost is True CPA's"); cost per issued policy stays True CPA's own figure.
 */

import type { VendorScorecardRow, VendorScorecardVendorRow } from "@/lib/vendorScorecard/types";

export const LEAD_SOURCES_PATH = "/app/source-results";
export const LEAD_SOURCES_TABS = ["vendors", "campaigns"] as const;
export type LeadSourcesTab = (typeof LEAD_SOURCES_TABS)[number];

export function leadSourcesTabOf(value: unknown): LeadSourcesTab {
  return (LEAD_SOURCES_TABS as readonly unknown[]).includes(value) ? (value as LeadSourcesTab) : "vendors";
}

/** One line of the report: a vendor, or a campaign. */
export type SourceLine = {
  key: string;
  label: string;
  /** The campaign's vendor; null on a vendor line. */
  vendor: string | null;
  href: string;
  test: boolean;
  received: number;
  dialed: number | null;
  contacted: number;
  applied: number | null;
  issued: number;
  /** Net spend in the period, cents; null when the spend cannot be split to it. */
  spendCents: number | null;
  costPerLeadCents: number | null;
  /** Median seconds from a posted lead to its first dial; vendors only, all time. */
  speedSeconds: number | null;
  /** Share of the vendor's leads with a consent claim on file; vendors only, all time. */
  consentPct: number | null;
};

export const vendorHref = (vendorId: string) => `/app/campaigns/vendors/${vendorId}`;
export const campaignHref = (campaignId: string) => `/app/campaigns/${campaignId}`;

export function vendorLine(row: VendorScorecardVendorRow): SourceLine {
  return {
    key: row.vendor_id,
    label: row.vendor_name || "Unnamed vendor",
    vendor: null,
    href: vendorHref(row.vendor_id),
    test: row.is_test_batch,
    received: row.leads_received,
    dialed: row.dialed_leads,
    contacted: row.contacted_leads,
    applied: row.applied_leads,
    issued: row.issued_policies,
    spendCents: row.net_spend_cents,
    costPerLeadCents: row.effective_cost_per_lead_cents,
    speedSeconds: row.speed_median_seconds,
    consentPct: row.consent_claimed_pct,
  };
}

export function campaignLine(row: VendorScorecardRow): SourceLine {
  return {
    key: row.campaign_id,
    label: row.campaign_name || "Unnamed campaign",
    vendor: row.vendor_name || null,
    href: campaignHref(row.campaign_id),
    test: row.is_test_batch,
    received: row.leads_received,
    dialed: row.dialed_leads,
    contacted: row.contacted_leads,
    applied: row.applied_leads,
    issued: row.issued_policies,
    spendCents: row.net_spend_cents,
    costPerLeadCents: row.effective_cost_per_lead_cents,
    speedSeconds: null,
    consentPct: null,
  };
}

/** The lines with leads in the period, most leads first. */
export function sourceLines<T>(rows: readonly T[], line: (row: T) => SourceLine): SourceLine[] {
  return rows.map(line).filter((l) => l.received > 0 || l.issued > 0).sort((a, b) => b.received - a.received || a.label.localeCompare(b.label));
}

/** A rate waits for this many leads; under it the line shows the two counts. */
export const MIN_LEADS = 20;

/** "42% contacted", "3 of 12" under the floor, "—" with no leads. */
export function rateText(part: number, whole: number, word: string): string {
  if (!whole) return "—";
  return whole >= MIN_LEADS ? `${Math.round((part / whole) * 100)}% ${word}` : `${part} of ${whole}`;
}

/** "45 s", "3 min", "2 h"; a dash with no dialled posted lead. */
export function speedText(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

/** Whole dollars; a dash when there is no figure. */
export function dollars(cents: number | null): string {
  return cents === null || !Number.isFinite(cents) ? "—" : `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** This report's address for a tab, with the period and the Table · Chart choice kept. */
export function leadSourcesHref(tab: LeadSourcesTab, period: { from: string; to: string } | null, show?: "table" | "chart"): string {
  const params = new URLSearchParams();
  if (tab !== "vendors") params.set("tab", tab);
  if (period) { params.set("from", period.from); params.set("to", period.to); }
  if (show) params.set("show", show);
  const query = params.toString();
  return query ? `${LEAD_SOURCES_PATH}?${query}` : LEAD_SOURCES_PATH;
}
