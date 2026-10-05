import "server-only";

import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { ApplicationError, db, isMissingSchema, rows, SchemaPendingError } from "./db";
import { OUTCOME_REASONS, PRODUCT_LABEL } from "./constants";
import { inChunks, optional } from "./lists";
import { buildSalesReport, defaultWindow, type ReportFilters, type ReportInput, type SalesReport } from "./reportRules";

/**
 * Sales performance (LA-3.21), read live from the base tables for one tenant and counted by
 * `buildSalesReport` (reportRules.ts states the counting rules).
 *
 * Why not `la3_sales_report()` (20260926101200): its materialised views are refreshed by nothing
 * yet, so they hold what existed when the migration ran; `mv_la3_declines` and
 * `mv_la3_counteroffers` carry no lead source, product or producer, so those filters could not
 * compose on the decline and counteroffer tables; there is no timing view; and the funnel counts a
 * household's two applications as one quoted lead. This reader applies the same definitions to the
 * rows themselves, so a figure matches a hand count the moment the row exists.
 */

const LIMIT = 20_000;

export async function loadSalesReport(tenantId: string, filters: Partial<ReportFilters> = {}, now = Date.now()): Promise<{ report: SalesReport; timeZone: string }> {
  const client = db();
  const timeZone = (await getWorkspaceTimezone(tenantId).catch(() => null)) ?? "UTC";
  const window = defaultWindow(now, timeZone);
  const resolved: ReportFilters = { ...filters, from: filters.from || window.from, to: filters.to || window.to };
  if (resolved.from > resolved.to) throw new ApplicationError("SALES_REPORT_RANGE_INVALID", "The start date is after the end date.", 400);

  const [attemptsQ, quotesQ, casesQ] = await Promise.all([
    client.from("tenant_applications").select("id, case_id, lead_id, insured_role, attempt_no, carrier_id, product_code, quote_id, status, outcome, outcome_reason_code, created_by, created_at, updated_at, submitted_at, outcome_recorded_at").eq("tenant_id", tenantId).limit(LIMIT),
    client.from("tenant_quotes").select("id, case_id, lead_id, insured_role, carrier_id, product_code, monthly_premium_cents, created_by, created_at").eq("tenant_id", tenantId).limit(LIMIT),
    client.from("tenant_application_cases").select("id, source, campaign_id").eq("tenant_id", tenantId).limit(LIMIT),
  ]);
  if (isMissingSchema(attemptsQ.error)) throw new SchemaPendingError("The application record");
  for (const q of [attemptsQ, quotesQ, casesQ]) if (q.error && !isMissingSchema(q.error)) throw new ApplicationError("APPLICATION_UNAVAILABLE", q.error.message, 500);

  type A = { id: string; case_id: string; lead_id: string; insured_role: "primary" | "spouse"; attempt_no: number; carrier_id: string | null; product_code: string | null; quote_id: string | null; status: ReportInput["attempts"][number]["status"]; outcome: ReportInput["attempts"][number]["outcome"]; outcome_reason_code: string | null; created_by: string | null; created_at: string; updated_at: string; submitted_at: string | null; outcome_recorded_at: string | null };
  type Q = { id: string; case_id: string; lead_id: string; insured_role: "primary" | "spouse"; carrier_id: string; product_code: string; monthly_premium_cents: number; created_by: string | null; created_at: string };
  const attempts = rows<A>(attemptsQ.data);
  const quotes = rows<Q>(quotesQ.data);
  const cases = rows<{ id: string; source: string | null; campaign_id: string | null }>(casesQ.data);

  const carrierIds = [...new Set([...attempts.map((a) => a.carrier_id), ...quotes.map((q) => q.carrier_id)].filter((x): x is string => Boolean(x)))];
  const producerIds = [...new Set([...attempts.map((a) => a.created_by), ...quotes.map((q) => q.created_by)].filter((x): x is string => Boolean(x)))];
  const campaignIds = [...new Set(cases.map((c) => c.campaign_id).filter((x): x is string => Boolean(x)))];
  const today = new Date(now).toISOString().slice(0, 10);

  const issuedIds = attempts.filter((a) => a.status === "closed" && a.outcome === "issued").map((a) => a.id);
  const [carriers, producers, campaigns, counteroffers, requirements, contracts, schedules, reasons, effective] = await Promise.all([
    inChunks<{ id: string; name: string }>(carrierIds, (chunk) => client.from("carriers").select("id, name").in("id", chunk)),
    // users has no tenant_id; the ids come from this tenant's own rows.
    inChunks<{ id: string; name: string | null }>(producerIds, (chunk) => client.from("users").select("id, name").in("id", chunk)),
    inChunks<{ id: string; name: string }>(campaignIds, (chunk) => client.from("tenant_campaigns").select("id, name").eq("tenant_id", tenantId).in("id", chunk)),
    optional<{ id: string; application_id: string; status: ReportInput["counteroffers"][number]["status"]; received_at: string; reason_code: string | null }>(client.from("tenant_application_counteroffers").select("id, application_id, status, received_at, reason_code").eq("tenant_id", tenantId).limit(LIMIT)),
    optional<{ application_id: string; kind: ReportInput["requirements"][number]["kind"]; raised_at: string; satisfied_at: string | null }>(client.from("tenant_application_requirements").select("application_id, kind, raised_at, satisfied_at").eq("tenant_id", tenantId).limit(LIMIT)),
    carrierIds.length ? optional<{ carrier_id: string; contract_level_bp: number; effective_from: string; is_active: boolean }>(client.from("tenant_carriers").select("carrier_id, contract_level_bp, effective_from, is_active").eq("tenant_id", tenantId).in("carrier_id", carrierIds)) : Promise.resolve([]),
    carrierIds.length ? optional<{ carrier_id: string; product_code: string; contract_level_bp: number; rate_bp: number; effective_from: string }>(client.from("commission_schedules").select("carrier_id, product_code, contract_level_bp, rate_bp, effective_from").eq("tenant_id", tenantId).eq("policy_year", 1).in("carrier_id", carrierIds)) : Promise.resolve([]),
    optional<{ code: string; label: string; tenant_id: string | null }>(client.from("application_outcome_reasons").select("code, label, tenant_id").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)),
    // The premium each issued application was placed on (an accepted counteroffer writes it, LA-3.26).
    inChunks<{ application_id: string; value: unknown }>(issuedIds, (chunk) => client.from("tenant_application_values").select("application_id, value").eq("tenant_id", tenantId).eq("field_key", "cov.monthly_premium").in("application_id", chunk)),
  ]);
  const effectiveBy = new Map(effective.filter((v) => typeof v.value === "number" && Number.isInteger(v.value) && (v.value as number) > 0).map((v) => [v.application_id, v.value as number]));

  // Year-one rate at the tenant's current contract level, per carrier + product (as the quote strip reads it).
  const latest = <T extends { effective_from: string }>(list: T[]) => [...list].filter((x) => x.effective_from <= today).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  const rates: ReportInput["rates"] = [];
  for (const carrierId of carrierIds) {
    const contract = latest(contracts.filter((c) => c.carrier_id === carrierId && c.is_active));
    if (!contract) continue;
    const codes = [...new Set(schedules.filter((s) => s.carrier_id === carrierId).map((s) => s.product_code))];
    for (const code of codes) {
      const sched = latest(schedules.filter((s) => s.carrier_id === carrierId && s.product_code === code && s.contract_level_bp === contract.contract_level_bp));
      if (sched) rates.push({ carrierId, productCode: code, rateBp: sched.rate_bp });
    }
  }

  const reasonLabels: Record<string, string> = Object.fromEntries(OUTCOME_REASONS.map((r) => [r.code, r.label]));
  for (const r of reasons.filter((x) => x.tenant_id === null)) reasonLabels[r.code] = r.label;
  for (const r of reasons.filter((x) => x.tenant_id !== null)) reasonLabels[r.code] = r.label;
  const productCodes = [...new Set([...attempts.map((a) => a.product_code), ...quotes.map((q) => q.product_code)].filter((x): x is string => Boolean(x)))];

  const input: ReportInput = {
    timeZone,
    carriers,
    products: productCodes.map((code) => ({ code, label: PRODUCT_LABEL[code] ?? code })),
    campaigns,
    producers: producers.map((u) => ({ id: u.id, name: u.name ?? "A colleague" })),
    cases: cases.map((c) => ({ id: c.id, source: c.source, campaignId: c.campaign_id })),
    attempts: attempts.map((a) => ({
      id: a.id, caseId: a.case_id, leadId: a.lead_id, insuredRole: a.insured_role, attemptNo: a.attempt_no, carrierId: a.carrier_id, productCode: a.product_code, quoteId: a.quote_id,
      status: a.status, outcome: a.outcome, outcomeReasonCode: a.outcome_reason_code, createdBy: a.created_by, createdAt: a.created_at, updatedAt: a.updated_at,
      submittedAt: a.submitted_at, outcomeRecordedAt: a.outcome_recorded_at, effectiveMonthlyCents: effectiveBy.get(a.id) ?? null,
    })),
    quotes: quotes.map((q) => ({ id: q.id, caseId: q.case_id, leadId: q.lead_id, insuredRole: q.insured_role, carrierId: q.carrier_id, productCode: q.product_code, monthlyPremiumCents: q.monthly_premium_cents, createdBy: q.created_by, createdAt: q.created_at })),
    counteroffers: counteroffers.map((o) => ({ id: o.id, applicationId: o.application_id, status: o.status, receivedAt: o.received_at, reasonCode: o.reason_code })),
    requirements: requirements.map((r) => ({ applicationId: r.application_id, kind: r.kind, raisedAt: r.raised_at, satisfiedAt: r.satisfied_at })),
    rates,
    reasonLabels,
  };
  return { report: buildSalesReport(input, resolved), timeZone };
}
