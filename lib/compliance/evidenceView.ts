import type { GapSeverity } from "./evidenceGaps";

/**
 * What the Evidence step's server page and its client views both use (foundation pass 2026-11-03). A plain
 * module, because a server page cannot call a "use client" export.
 */
export type EvidenceQuery = { phone: string; from: string; to: string; lead: string; contact: string };
/** A report's tabs; Gaps first, as LA-6.3 orders the report. */
export type EvidenceView = "gaps" | "consent" | "leads" | "timeline";
export const EVIDENCE_VIEWS: readonly EvidenceView[] = ["gaps", "consent", "leads", "timeline"];

export const SEVERITY_TONE: Record<GapSeverity, "danger" | "warning" | "neutral"> = { critical: "danger", high: "warning", medium: "neutral" };
export const SEVERITY_LABEL: Record<GapSeverity, string> = { critical: "Fix today", high: "High", medium: "Medium" };

/** The query string for a scope (and a tab or a finding), leaving out what is empty. */
export function evidenceQuery(query: EvidenceQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...extra })) if (value) params.set(key, value);
  return params.toString();
}

/** The page's two lists (round 7): the findings, and the reports run (LA-6.3's log). `?tab=runs`. */
export type EvidenceTab = "findings" | "runs";

/** The page's address for a scope (and extras), with nothing empty in it. */
export const evidenceHref = (query: EvidenceQuery, extra: Record<string, string> = {}) => {
  const qs = evidenceQuery(query, extra);
  return qs ? `/app/evidence-report?${qs}` : "/app/evidence-report";
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "11 Nov 09:12" (UTC), with the year when it is not this year. */
export function whenShort(iso: string, ref = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const year = d.getUTCFullYear() === ref.getUTCFullYear() ? "" : ` ${d.getUTCFullYear()}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * A logged range back as the days it was asked for: `range_to` is stored as the next midnight (evidenceRange), so
 * the last day asked is the day before it.
 */
export function rangeDays(from: string | null, to: string | null): { from: string; to: string } {
  const last = to ? new Date(new Date(to).getTime() - 86_400_000) : null;
  return { from: from ? from.slice(0, 10) : "", to: last && !Number.isNaN(last.getTime()) ? last.toISOString().slice(0, 10) : "" };
}

const dayWords = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

type RunLike = { scopeType: string; scopeValue: string | null; scopeName: string | null; rangeFrom: string | null; rangeTo: string | null };

/** What a run covered, in words: "(704) 555-2098", "Lead · Nina Robertson", "1 Oct 2026 – 31 Oct 2026", "Whole book". */
export function runScope(run: RunLike, phone: (digits: string) => string): string {
  const days = rangeDays(run.rangeFrom, run.rangeTo);
  const range = days.from || days.to ? `${days.from ? dayWords(days.from) : "the start"} – ${days.to ? dayWords(days.to) : "today"}` : "";
  if (run.scopeValue === "[erased]") return "Erased on request";
  switch (run.scopeType) {
    case "phone": return run.scopeValue ? phone(run.scopeValue) : "A number";
    case "lead": return `Lead · ${run.scopeName ?? "no longer here"}`;
    case "contact": return "A client";
    case "date_range": return range || "Whole book";
    default: return range ? `Whole book · ${range}` : "Whole book";
  }
}

/** The address that reopens a run's scope, or null when it can't be reopened (a number erased on request). */
export function runHref(run: RunLike): string | null {
  if (run.scopeValue === "[erased]") return null;
  const days = rangeDays(run.rangeFrom, run.rangeTo);
  const base = { phone: "", lead: "", contact: "", from: days.from, to: days.to };
  if (run.scopeType === "phone") return run.scopeValue ? evidenceHref({ ...base, phone: run.scopeValue }) : null;
  if (run.scopeType === "lead") return run.scopeValue ? evidenceHref({ ...base, lead: run.scopeValue }) : null;
  if (run.scopeType === "contact") return run.scopeValue ? evidenceHref({ ...base, contact: run.scopeValue }) : null;
  return evidenceHref(base);
}

/** The Run a report dialog's check on a date range: a message when it ends before it starts. */
export function rangeProblem(from: string, to: string): string | null {
  return from && to && from > to ? "The range ends before it starts." : null;
}
