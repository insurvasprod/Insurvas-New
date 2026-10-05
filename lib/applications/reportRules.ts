// Sales performance (LA-3.21), pure and client-safe. The server loader (report.ts) reads the base
// tables for one tenant and hands them here; the page and the CSV export render what comes back.
//
// Counting rules — stated once, because each figure has to match a hand count:
//   · The window is by the tenant's local day (agency_profiles.timezone, else UTC).
//   · The page's population is the applications (attempts) SUBMITTED in the window. Issued, declined
//     and counteroffered are counted among those, whenever the outcome arrived, so every rate's
//     numerator is part of its denominator. A spouse's application is its own application and
//     counts once, beside the primary's (LA-3.24).
//   · The funnel counts insureds (a lead's primary, and the spouse separately) whose FIRST quote
//     fell in the window, and follows each one forward once: applied (an attempt reached ready or
//     was submitted), submitted, issued. An insured with a declined attempt 1 and an issued attempt 2
//     is one submitted and one issued, not two.
//   · Placed is null: no first-draft result is recorded anywhere yet. It is never inferred from
//     issued, and the page labels it Partial.
//   · Estimated first-year commission = issued monthly premium × 12 × the year-one rate at the
//     tenant's contract level, rounded half up, integer cents. Issued applications with no rate on
//     file are left out and counted.
//   · Filters compose: carrier, product, lead source (case source or campaign) and producer (who
//     created the attempt; for the funnel, who created the first quote).

import type { ApplicationOutcome, ApplicationStatus, InsuredRole, RequirementKind } from "./constants.ts";

export const MIN_CASES = 5;

export type ReportAttempt = {
  id: string; caseId: string; leadId: string; insuredRole: InsuredRole; attemptNo: number;
  carrierId: string | null; productCode: string | null; quoteId: string | null;
  status: ApplicationStatus; outcome: ApplicationOutcome | null; outcomeReasonCode: string | null;
  createdBy: string | null; createdAt: string; updatedAt: string; submittedAt: string | null; outcomeRecordedAt: string | null;
  /** The premium the policy was placed on when it differs from the quote: an accepted counteroffer (LA-3.26). */
  effectiveMonthlyCents?: number | null;
};
export type ReportQuote = { id: string; caseId: string; leadId: string; insuredRole: InsuredRole; carrierId: string; productCode: string; monthlyPremiumCents: number; createdBy: string | null; createdAt: string };
export type ReportCase = { id: string; source: string | null; campaignId: string | null };
export type ReportCounteroffer = { id: string; applicationId: string; status: "pending_client" | "accepted" | "rejected" | "expired"; receivedAt: string; reasonCode: string | null };
export type ReportRequirement = { applicationId: string; kind: RequirementKind; raisedAt: string; satisfiedAt: string | null };

export type ReportInput = {
  timeZone: string;
  carriers: { id: string; name: string }[];
  products: { code: string; label: string }[];
  campaigns: { id: string; name: string }[];
  producers: { id: string; name: string }[];
  cases: ReportCase[];
  attempts: ReportAttempt[];
  quotes: ReportQuote[];
  counteroffers: ReportCounteroffer[];
  requirements: ReportRequirement[];
  /** Year-one commission rate at the tenant's contract level, per carrier + product, basis points. */
  rates: { carrierId: string; productCode: string; rateBp: number }[];
  /** Labels for outcome reason codes (platform and tenant lists). */
  reasonLabels: Record<string, string>;
};

export type ReportFilters = { from: string; to: string; carrierId?: string | null; productCode?: string | null; source?: string | null; producerId?: string | null };

export type Ratio = { n: number; d: number };
export type Median = { value: number | null; n: number };

export type SalesReport = {
  from: string;
  to: string;
  totals: { submitted: number; issued: Ratio; declined: Ratio; counteroffered: Ratio };
  funnel: { quoted: number; applied: Ratio; submitted: Ratio; issued: Ratio; placed: null };
  declines: {
    carriers: { id: string; name: string; total: number }[];
    rows: { key: string; label: string; byCarrier: Record<string, number>; total: number }[];
    total: number;
  };
  counteroffers: {
    rows: { carrierId: string; name: string; submitted: number; counteroffered: number; accepted: number; refused: number; expired: number; pending: number; topReason: string | null }[];
    total: { submitted: number; counteroffered: number; accepted: number; refused: number; expired: number; pending: number };
  };
  timing: {
    rows: { carrierId: string; name: string; quoteToSubmitHours: Median; submitToIssueDays: Median }[];
    all: { quoteToSubmitHours: Median; submitToIssueDays: Median };
    requirements: { kind: RequirementKind; byCarrier: Record<string, Median>; all: Median }[];
  };
  premium: {
    rows: { carrierId: string; name: string; submittedAnnualCents: number; issuedAnnualCents: number; issuedCount: number; estimatedFycCents: number; ratedCount: number }[];
    total: { submittedAnnualCents: number; issuedAnnualCents: number; issuedCount: number; estimatedFycCents: number; ratedCount: number };
  };
  options: { carriers: { id: string; name: string }[]; products: { code: string; label: string }[]; sources: { value: string; label: string }[]; producers: { id: string; name: string }[] };
};

// What the carrier decided, and the client's answer to a carrier's offer. A withdrawn attempt is the
// agency pulling its own application: it is not a decline, and counting it inflated every carrier's rate.
const CLOSED_WITHOUT_POLICY: readonly ApplicationOutcome[] = ["declined", "postponed", "declined_by_client", "offer_expired"];
const SOURCE_LABEL: Record<string, string> = { inbound: "Inbound transfers", outbound: "Outbound", manual: "Added by hand" };

/** a / b half up for non-negative integers. */
function divRoundHalfUp(a: number, b: number) {
  return Math.floor((a * 2 + b) / (b * 2));
}

/** The calendar day an ISO time falls on in a zone, YYYY-MM-DD. */
export function dayIn(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(raw * 10) / 10;
}

/** Rate for display, integer percent; null under a zero denominator. */
export function pct(r: Ratio, digits = 0): number | null {
  if (r.d <= 0) return null;
  const f = 10 ** digits;
  return Math.round((r.n / r.d) * 100 * f) / f;
}

/** A cross-tab cell: a percentage only from MIN_CASES cases up, else the greyed count. */
export function crossCell(n: number, d: number): { kind: "count"; text: string } | { kind: "rate"; text: string; detail: string } {
  if (n < MIN_CASES) return { kind: "count", text: `n=${n}` };
  return { kind: "rate", text: `${pct({ n, d })}%`, detail: `(${n}/${d})` };
}

export function sourceKey(c: ReportCase | undefined): string[] {
  if (!c) return [];
  const keys: string[] = [];
  if (c.source) keys.push(`source:${c.source}`);
  if (c.campaignId) keys.push(`campaign:${c.campaignId}`);
  return keys;
}

export function buildSalesReport(input: ReportInput, filters: ReportFilters): SalesReport {
  const tz = input.timeZone || "UTC";
  const inWindow = (iso: string | null) => {
    if (!iso) return false;
    const day = dayIn(iso, tz);
    return day >= filters.from && day <= filters.to;
  };
  const caseById = new Map(input.cases.map((c) => [c.id, c]));
  const carrierName = new Map(input.carriers.map((c) => [c.id, c.name]));
  const nameOf = (id: string) => carrierName.get(id) ?? "Unknown carrier";
  const matchesCase = (caseId: string) => !filters.source || sourceKey(caseById.get(caseId)).includes(filters.source);
  const matchesAttempt = (a: ReportAttempt) =>
    (!filters.carrierId || a.carrierId === filters.carrierId)
    && (!filters.productCode || a.productCode === filters.productCode)
    && (!filters.producerId || a.createdBy === filters.producerId)
    && matchesCase(a.caseId);

  // ── the population: applications submitted in the window ─────────────────
  const population = input.attempts.filter((a) => a.submittedAt && inWindow(a.submittedAt) && matchesAttempt(a));
  const popIds = new Set(population.map((a) => a.id));
  const coByApp = new Map<string, ReportCounteroffer[]>();
  for (const o of input.counteroffers) {
    if (!popIds.has(o.applicationId)) continue;
    coByApp.set(o.applicationId, [...(coByApp.get(o.applicationId) ?? []), o]);
  }
  const issued = population.filter((a) => a.status === "closed" && a.outcome === "issued");
  const declined = population.filter((a) => a.status === "closed" && a.outcome !== null && CLOSED_WITHOUT_POLICY.includes(a.outcome));
  const counteroffered = population.filter((a) => (coByApp.get(a.id)?.length ?? 0) > 0);
  const submitted = population.length;

  // ── funnel: insureds by first quote ───────────────────────────────────────
  const insuredKey = (leadId: string, caseId: string, role: InsuredRole) => `${leadId}|${caseId}|${role}`;
  const firstQuote = new Map<string, ReportQuote>();
  for (const q of [...input.quotes].sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id))) {
    const key = insuredKey(q.leadId, q.caseId, q.insuredRole);
    if (!firstQuote.has(key)) firstQuote.set(key, q);
  }
  const attemptsByInsured = new Map<string, ReportAttempt[]>();
  for (const a of input.attempts) {
    const key = insuredKey(a.leadId, a.caseId, a.insuredRole);
    attemptsByInsured.set(key, [...(attemptsByInsured.get(key) ?? []), a]);
  }
  let quoted = 0; let applied = 0; let fSubmitted = 0; let fIssued = 0;
  for (const [key, q] of firstQuote) {
    if (!inWindow(q.createdAt)) continue;
    if (filters.carrierId && q.carrierId !== filters.carrierId) continue;
    if (filters.productCode && q.productCode !== filters.productCode) continue;
    if (filters.producerId && q.createdBy !== filters.producerId) continue;
    if (!matchesCase(q.caseId)) continue;
    quoted += 1;
    const tries = attemptsByInsured.get(key) ?? [];
    if (tries.some((a) => a.submittedAt || ["ready", "submitted", "pending_carrier", "counteroffer_pending"].includes(a.status))) applied += 1;
    if (tries.some((a) => a.submittedAt)) fSubmitted += 1;
    if (tries.some((a) => a.status === "closed" && a.outcome === "issued")) fIssued += 1;
  }

  // ── decline reasons × carrier ─────────────────────────────────────────────
  const declineCarrierTotals = new Map<string, number>();
  const reasonRows = new Map<string, { key: string; label: string; byCarrier: Record<string, number>; total: number }>();
  const reasonKey = (a: ReportAttempt) => (a.outcome === "declined_by_client" ? "outcome:declined_by_client" : a.outcome === "offer_expired" ? "outcome:offer_expired" : a.outcomeReasonCode ? `reason:${a.outcomeReasonCode}` : `outcome:${a.outcome}`);
  const reasonLabel = (key: string) => {
    if (key === "outcome:declined_by_client") return "Client refused the counteroffer";
    if (key === "outcome:offer_expired") return "Counteroffer expired";
    if (key.startsWith("reason:")) return input.reasonLabels[key.slice(7)] ?? key.slice(7).replace(/_/g, " ");
    return `No reason recorded (${key.slice(8).replace(/_/g, " ")})`;
  };
  for (const a of declined) {
    const carrier = a.carrierId ?? "none";
    declineCarrierTotals.set(carrier, (declineCarrierTotals.get(carrier) ?? 0) + 1);
    const key = reasonKey(a);
    const row = reasonRows.get(key) ?? { key, label: reasonLabel(key), byCarrier: {}, total: 0 };
    row.byCarrier[carrier] = (row.byCarrier[carrier] ?? 0) + 1;
    row.total += 1;
    reasonRows.set(key, row);
  }
  const declineCarriers = [...declineCarrierTotals.entries()]
    .map(([id, total]) => ({ id, name: id === "none" ? "No carrier" : nameOf(id), total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  // ── per-carrier breakdowns over the population ───────────────────────────
  const carriersInPop = [...new Set(population.map((a) => a.carrierId ?? "none"))];
  const carrierLabel = (id: string) => (id === "none" ? "No carrier" : nameOf(id));
  const byCarrier = (id: string) => population.filter((a) => (a.carrierId ?? "none") === id);

  const coRow = (list: ReportAttempt[]) => {
    const offers = list.flatMap((a) => coByApp.get(a.id) ?? []);
    const reasons = new Map<string, number>();
    for (const o of offers) if (o.reasonCode) reasons.set(o.reasonCode, (reasons.get(o.reasonCode) ?? 0) + 1);
    const top = [...reasons.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? null;
    return {
      submitted: list.length,
      counteroffered: list.filter((a) => (coByApp.get(a.id)?.length ?? 0) > 0).length,
      accepted: offers.filter((o) => o.status === "accepted").length,
      refused: offers.filter((o) => o.status === "rejected").length,
      expired: offers.filter((o) => o.status === "expired").length,
      pending: offers.filter((o) => o.status === "pending_client").length,
      topReason: top ? input.reasonLabels[top] ?? top.replace(/_/g, " ") : null,
    };
  };
  const counterRows = carriersInPop.map((id) => ({ carrierId: id, name: carrierLabel(id), ...coRow(byCarrier(id)) }))
    .filter((r) => r.counteroffered > 0 || r.submitted > 0)
    .sort((a, b) => b.counteroffered - a.counteroffered || a.name.localeCompare(b.name));
  const counterAll = coRow(population);

  // ── timing ────────────────────────────────────────────────────────────────
  const hoursToSubmit = (a: ReportAttempt) => {
    const q = firstQuote.get(insuredKey(a.leadId, a.caseId, a.insuredRole));
    if (!q || !a.submittedAt) return null;
    const h = (Date.parse(a.submittedAt) - Date.parse(q.createdAt)) / 3_600_000;
    return h >= 0 ? Math.round(h * 10) / 10 : null;
  };
  const daysToIssue = (a: ReportAttempt) => {
    if (!(a.status === "closed" && a.outcome === "issued") || !a.submittedAt || !a.outcomeRecordedAt) return null;
    const d = (Date.parse(a.outcomeRecordedAt) - Date.parse(a.submittedAt)) / 86_400_000;
    return d >= 0 ? Math.round(d * 10) / 10 : null;
  };
  const med = (values: (number | null)[]): Median => { const v = values.filter((x): x is number => x !== null); return { value: median(v), n: v.length }; };
  const timingRows = carriersInPop.map((id) => ({ carrierId: id, name: carrierLabel(id), quoteToSubmitHours: med(byCarrier(id).map(hoursToSubmit)), submitToIssueDays: med(byCarrier(id).map(daysToIssue)) }))
    .sort((a, b) => b.quoteToSubmitHours.n - a.quoteToSubmitHours.n || a.name.localeCompare(b.name));
  const reqDays = (r: ReportRequirement) => {
    const end = r.satisfiedAt ?? null;
    if (!end) return null;
    const d = (Date.parse(`${end.slice(0, 10)}T00:00:00Z`) - Date.parse(`${r.raisedAt.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
    return d >= 0 ? d : null;
  };
  const popById = new Map(population.map((a) => [a.id, a]));
  const reqs = input.requirements.filter((r) => popById.has(r.applicationId));
  const kinds = [...new Set(reqs.map((r) => r.kind))].sort();
  const requirementTiming = kinds.map((kind) => {
    const list = reqs.filter((r) => r.kind === kind);
    const perCarrier: Record<string, Median> = {};
    for (const id of carriersInPop) perCarrier[id] = med(list.filter((r) => (popById.get(r.applicationId)?.carrierId ?? "none") === id).map(reqDays));
    return { kind, byCarrier: perCarrier, all: med(list.map(reqDays)) };
  });

  // ── premium and estimated commission ─────────────────────────────────────
  const quotePremium = new Map(input.quotes.map((q) => [q.id, q.monthlyPremiumCents]));
  const rate = new Map(input.rates.map((r) => [`${r.carrierId}|${r.productCode}`, r.rateBp]));
  const premiumRow = (list: ReportAttempt[]) => {
    let submittedAnnualCents = 0; let issuedAnnualCents = 0; let estimatedFycCents = 0; let ratedCount = 0; let issuedCount = 0;
    for (const a of list) {
      const monthly = a.quoteId ? quotePremium.get(a.quoteId) ?? 0 : 0;
      submittedAnnualCents += monthly * 12;
      if (a.status === "closed" && a.outcome === "issued") {
        // Issued on the carrier's terms: after an accepted counteroffer that is its premium, so the FYC
        // estimate is recalculated from it (LA-3.26). Submitted stays what was applied for.
        const placed = a.effectiveMonthlyCents && a.effectiveMonthlyCents > 0 ? a.effectiveMonthlyCents : monthly;
        issuedCount += 1;
        issuedAnnualCents += placed * 12;
        const bp = a.carrierId && a.productCode ? rate.get(`${a.carrierId}|${a.productCode}`) : undefined;
        if (bp !== undefined && placed > 0) { estimatedFycCents += divRoundHalfUp(placed * 12 * bp, 10_000); ratedCount += 1; }
      }
    }
    return { submittedAnnualCents, issuedAnnualCents, issuedCount, estimatedFycCents, ratedCount };
  };
  const premiumRows = carriersInPop.map((id) => ({ carrierId: id, name: carrierLabel(id), ...premiumRow(byCarrier(id)) }))
    .sort((a, b) => b.submittedAnnualCents - a.submittedAnnualCents || a.name.localeCompare(b.name));

  // ── filter options (from all the tenant's data, not the filtered slice) ──
  const usedCarriers = new Set([...input.attempts.map((a) => a.carrierId), ...input.quotes.map((q) => q.carrierId)].filter((x): x is string => Boolean(x)));
  const usedProducts = new Set([...input.attempts.map((a) => a.productCode), ...input.quotes.map((q) => q.productCode)].filter((x): x is string => Boolean(x)));
  const usedProducers = new Set([...input.attempts.map((a) => a.createdBy), ...input.quotes.map((q) => q.createdBy)].filter((x): x is string => Boolean(x)));
  const sources = [...new Set(input.cases.map((c) => c.source).filter((x): x is string => Boolean(x)))].sort()
    .map((s) => ({ value: `source:${s}`, label: SOURCE_LABEL[s] ?? s }));
  const usedCampaigns = new Set(input.cases.map((c) => c.campaignId).filter((x): x is string => Boolean(x)));
  const campaigns = input.campaigns.filter((c) => usedCampaigns.has(c.id)).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: `campaign:${c.id}`, label: c.name }));

  return {
    from: filters.from,
    to: filters.to,
    totals: { submitted, issued: { n: issued.length, d: submitted }, declined: { n: declined.length, d: submitted }, counteroffered: { n: counteroffered.length, d: submitted } },
    funnel: { quoted, applied: { n: applied, d: quoted }, submitted: { n: fSubmitted, d: applied }, issued: { n: fIssued, d: fSubmitted }, placed: null },
    declines: { carriers: declineCarriers, rows: [...reasonRows.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label)), total: declined.length },
    counteroffers: { rows: counterRows, total: { submitted: counterAll.submitted, counteroffered: counterAll.counteroffered, accepted: counterAll.accepted, refused: counterAll.refused, expired: counterAll.expired, pending: counterAll.pending } },
    timing: { rows: timingRows, all: { quoteToSubmitHours: med(population.map(hoursToSubmit)), submitToIssueDays: med(population.map(daysToIssue)) }, requirements: requirementTiming },
    premium: { rows: premiumRows, total: premiumRow(population) },
    options: {
      carriers: input.carriers.filter((c) => usedCarriers.has(c.id)).sort((a, b) => a.name.localeCompare(b.name)),
      products: input.products.filter((p) => usedProducts.has(p.code)).sort((a, b) => a.label.localeCompare(b.label)),
      sources: [...sources, ...campaigns],
      producers: input.producers.filter((p) => usedProducers.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

/** Default window: the last 90 days up to today, in the tenant's zone. */
export function defaultWindow(now: number, timeZone: string, days = 90): { from: string; to: string } {
  const to = dayIn(new Date(now).toISOString(), timeZone);
  const from = dayIn(new Date(now - (days - 1) * 86_400_000).toISOString(), timeZone);
  return { from, to };
}
