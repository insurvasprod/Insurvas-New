// Pure partner-quality arithmetic, shared by the service (server) and the workspaces (client).
// No imports that pull in server code: the list and detail pages are client components.
import type { PartnerQualityDailyRow, PartnerQualityDisposition, PartnerQualityDispositionBreakdown, PartnerQualityEvidence, PartnerQualityPeriod, PartnerQualityPeriodMetrics, PartnerQualityReport, PartnerQualityRow, PartnerQualityScreening, PartnerQualitySummary } from "./types";

// Product decision: reporting is fixed EST (UTC-5), not the reader's timezone and not a
// daylight-saving-aware New York clock. Keep this value aligned with the database functions.
export const PARTNER_QUALITY_TIME_ZONE = "Etc/GMT+5";

export function partnerQualityToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PARTNER_QUALITY_TIME_ZONE }).format(now);
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A {from, to} pair from a query string, or null unless both are YYYY-MM-DD and in order. */
export function validPartnerQualityPeriod(from: string | null | undefined, to: string | null | undefined): { from: string; to: string } | null {
  return from && to && ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to ? { from, to } : null;
}

/** The last 30 reporting days, ending today (the workspaces' default period). */
export function defaultPartnerQualityPeriod(now = new Date()): { from: string; to: string } {
  const to = partnerQualityToday(now);
  return { from: shiftDate(to, -29), to };
}

/** The period of the same length immediately before [from, to] — the rule partner_quality_report uses. */
export function previousPartnerQualityPeriod(from: string, to: string): { from: string; to: string } {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from: shiftDate(from, -days), to: shiftDate(from, -1) };
}

/** Every date in [from, to], newest first. */
export function datesBetween(from: string, to: string, max = 400): string[] {
  const dates: string[] = [];
  for (let day = to; day >= from && dates.length < max; day = shiftDate(day, -1)) dates.push(day);
  return dates;
}

export function percentOf(value: number, total: number): number | null {
  return total ? Math.round((value * 1000) / total) / 10 : null;
}

export function screeningFlags(screening: PartnerQualityScreening): number {
  return screening.tcpa + screening.dnc + screening.invalid;
}

/** Share of sent leads with no TCPA, DNC or invalid-phone flag. Null when nothing was sent. */
export function screeningPassRate(period: { sent: number; screening: PartnerQualityScreening }): number | null {
  return period.sent ? Math.round(((period.sent - screeningFlags(period.screening)) * 1000) / period.sent) / 10 : null;
}

export function isTcpa(row: PartnerQualityEvidence) { return row.screening_result_outcome === "tcpa_litigator"; }
export function isDnc(row: PartnerQualityEvidence) { return row.screening_result_outcome === "dnc" || row.screening_outcome === "dnc"; }
export function isInvalid(row: PartnerQualityEvidence) { return row.screening_result_outcome === "invalid_phone"; }
export function isDisqualified(row: PartnerQualityEvidence) { return row.screening_outcome === "internal_dq"; }

/** The same counts partner_quality_report computes per partner, for any slice of evidence. */
export function periodMetrics(evidence: PartnerQualityEvidence[]): PartnerQualityPeriodMetrics {
  const sent = evidence.length;
  const count = (predicate: (row: PartnerQualityEvidence) => boolean) => evidence.filter(predicate).length;
  const claimed = count((row) => row.claimed);
  const worked = count((row) => row.worked);
  const submitted = count((row) => row.submitted);
  const disqualified = count(isDisqualified);
  const duplicates = count((row) => row.duplicate);
  const screening = { tcpa: count(isTcpa), dnc: count(isDnc), invalid: count(isInvalid) };
  return {
    sent, claimed, worked, submitted, disqualified, duplicates, screening,
    conversion_rate: percentOf(submitted, sent),
    disqualification_rate: percentOf(disqualified, sent),
    duplicate_rate: percentOf(duplicates, sent),
    screening_pass_rate: screeningPassRate({ sent, screening }),
  };
}

/** One word for a lead's screening result, worst flag first. */
export function screeningLabel(row: PartnerQualityEvidence): string {
  if (isTcpa(row)) return "TCPA blocked";
  if (isDnc(row)) return "DNC flagged";
  if (isInvalid(row)) return "Invalid phone";
  if (isDisqualified(row)) return "Disqualified";
  return row.screening_outcome === "clear" ? "Passed" : "Not checked";
}

/** Latest disposition per lead, counted; most common first. */
export function dispositionBreakdown(evidence: PartnerQualityEvidence[]): PartnerQualityDisposition[] {
  const counts = new Map<string, number>();
  for (const row of evidence) if (row.disposition) counts.set(row.disposition, (counts.get(row.disposition) ?? 0) + 1);
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Per reporting day in [from, to], newest first, including days with nothing sent. */
export function dailyVolume(evidence: PartnerQualityEvidence[], from: string, to: string): PartnerQualityDailyRow[] {
  const byDay = new Map<string, PartnerQualityEvidence[]>();
  for (const row of evidence) byDay.set(row.lead_date, [...(byDay.get(row.lead_date) ?? []), row]);
  return datesBetween(from, to).map((date) => {
    const rows = byDay.get(date) ?? [];
    const metrics = periodMetrics(rows);
    return { date, sent: metrics.sent, claimed: metrics.claimed, worked: metrics.worked, submitted: metrics.submitted, flagged: screeningFlags(metrics.screening), duplicates: metrics.duplicates };
  });
}

/** The first day of the current reporting month (partner_quality_report's default "from"). */
export function partnerQualityMonthStart(now = new Date()): string {
  return `${partnerQualityToday(now).slice(0, 8)}01`;
}

function periodOf(metrics: PartnerQualityPeriodMetrics): PartnerQualityPeriod {
  return { sent: metrics.sent, claimed: metrics.claimed, worked: metrics.worked, submitted: metrics.submitted, conversion_rate: metrics.conversion_rate, disqualification_rate: metrics.disqualification_rate, duplicate_rate: metrics.duplicate_rate, screening: metrics.screening };
}

function summaryOf(metrics: PartnerQualityPeriodMetrics): PartnerQualitySummary {
  return { sent: metrics.sent, claimed: metrics.claimed, worked: metrics.worked, submitted: metrics.submitted, disqualified: metrics.disqualified, duplicates: metrics.duplicates, screening: metrics.screening };
}

/**
 * The list page's report, counted from partner_quality_evidence exactly as partner_quality_report
 * counts it in SQL: one row per partner of the tenant (a partner with no leads is a zero row), its
 * previous-period figures, the disposition breakdown and both summaries. Counting here from two
 * evidence reads replaces the SQL report, which evaluated the evidence five times in one statement
 * and ran past the statement timeout on a busy month.
 */
export function buildPartnerQualityReport(
  partners: ReadonlyArray<{ id: string; name: string; partner_type: string | null }>,
  current: PartnerQualityEvidence[],
  previous: PartnerQualityEvidence[],
  period: { from: string; to: string; previous_from: string; previous_to: string },
): Omit<PartnerQualityReport, "team" | "readOnly"> {
  const group = (evidence: PartnerQualityEvidence[]) => {
    const byPartner = new Map<string, PartnerQualityEvidence[]>();
    for (const row of evidence) byPartner.set(row.partner_id, [...(byPartner.get(row.partner_id) ?? []), row]);
    return byPartner;
  };
  const currentByPartner = group(current);
  const previousByPartner = group(previous);
  const rows: PartnerQualityRow[] = partners
    .map((partner) => {
      const now = periodMetrics(currentByPartner.get(partner.id) ?? []);
      const before = periodMetrics(previousByPartner.get(partner.id) ?? []);
      return { partner_id: partner.id, partner_name: partner.name, partner_type: partner.partner_type, ...periodOf(now), disqualified: now.disqualified, duplicates: now.duplicates, previous: periodOf(before) };
    })
    .sort((a, b) => a.partner_name.localeCompare(b.partner_name) || a.partner_id.localeCompare(b.partner_id));
  const dispositions: PartnerQualityDispositionBreakdown[] = [...currentByPartner.entries()]
    .map(([partner_id, evidence]) => ({ partner_id, dispositions: dispositionBreakdown(evidence).sort((a, b) => a.key.localeCompare(b.key)) }))
    .filter((entry) => entry.dispositions.length > 0)
    .sort((a, b) => a.partner_id.localeCompare(b.partner_id));
  return { ...period, rows, dispositions, summary: summaryOf(periodMetrics(current)), previous_summary: summaryOf(periodMetrics(previous)) };
}

/** Percent change from `previous` to `current`, rounded; null when there is no base to compare with. */
export function percentChange(current: number, previous: number): number | null {
  return previous ? Math.round(((current - previous) / previous) * 100) : null;
}

/** Difference in percentage points, one decimal; null when either side has no rate. */
export function pointChange(current: number | null, previous: number | null): number | null {
  return current == null || previous == null ? null : Math.round((current - previous) * 10) / 10;
}
