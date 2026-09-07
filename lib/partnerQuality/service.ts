import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { PartnerQualityLeadResult, PartnerQualityMetric, PartnerQualityReport } from "./types";
import { PARTNER_QUALITY_METRICS } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertPartnerQualityUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

export function assertPartnerQualityDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !DATE.test(value)) throw new Error(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} is not a real calendar date`);
  return value;
}

function page(value: unknown, fallback: number, max: number) {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isInteger(result) && result > 0 ? Math.min(max, result) : fallback;
}

function metric(value: unknown): PartnerQualityMetric {
  if (typeof value !== "string" || !PARTNER_QUALITY_METRICS.includes(value as PartnerQualityMetric)) throw new Error("Choose a valid quality metric");
  return value as PartnerQualityMetric;
}

function normalizeReport(value: unknown, readOnly: boolean): PartnerQualityReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The partner quality report was invalid");
  const report = value as Omit<PartnerQualityReport, "readOnly">;
  return { ...report, rows: Array.isArray(report.rows) ? report.rows : [], dispositions: Array.isArray(report.dispositions) ? report.dispositions : [], readOnly };
}

export async function listPartnerQuality(tenantId: string, filters: { from?: unknown; to?: unknown }, readOnly: boolean) {
  const from = filters.from == null || filters.from === "" ? null : assertPartnerQualityDate(filters.from, "From date");
  const to = filters.to == null || filters.to === "" ? null : assertPartnerQualityDate(filters.to, "To date");
  if (from && to && from > to) throw new Error("From date must be on or before To date");
  const { data, error } = await getSupabaseServiceClient().rpc("partner_quality_report", { p_tenant_id: tenantId, p_from_date: from, p_to_date: to });
  if (error) throw new Error(`Could not load partner quality: ${error.message}`);
  return normalizeReport(data, readOnly);
}

export async function listPartnerQualityLeads(tenantId: string, filters: { from: unknown; to: unknown; partnerId: unknown; metric: unknown; disposition?: unknown; page?: unknown; pageSize?: unknown }) {
  const from = assertPartnerQualityDate(filters.from, "From date");
  const to = assertPartnerQualityDate(filters.to, "To date");
  if (from > to) throw new Error("From date must be on or before To date");
  const partnerId = assertPartnerQualityUuid(filters.partnerId, "partner");
  const selectedMetric = metric(filters.metric);
  const disposition = filters.disposition == null || filters.disposition === "" ? null : typeof filters.disposition === "string" && /^[a-z][a-z0-9_]{1,79}$/.test(filters.disposition) ? filters.disposition : (() => { throw new Error("Invalid disposition"); })();
  const { data, error } = await getSupabaseServiceClient().rpc("partner_quality_leads", { p_tenant_id: tenantId, p_from_date: from, p_to_date: to, p_partner_id: partnerId, p_metric: selectedMetric, p_disposition: disposition, p_page: page(filters.page, 1, 1000), p_page_size: page(filters.pageSize, 100, 1000) });
  if (error) throw new Error(`Could not load partner quality leads: ${error.message}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("The partner quality drill-down was invalid");
  const result = data as Partial<PartnerQualityLeadResult>;
  return { metric: selectedMetric, partner_id: partnerId, total: typeof result.total === "number" ? result.total : 0, rows: Array.isArray(result.rows) ? result.rows : [] } as PartnerQualityLeadResult;
}
