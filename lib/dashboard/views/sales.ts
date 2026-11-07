/**
 * The Overview's sales reads (owner 2026-11-06, canvas round 2 screen 1): "My recent business" (the cases
 * worked in the last seven days) and today's quotes and sales for "On the phone today".
 *
 * Two halves, as the other view loaders: the top is pure shaping (no I/O, no alias imports) so
 * lib/dashboard/views/sales.test.mjs runs it under node; `loadSalesSnapshot` at the bottom reads the same two
 * lists the Applications page reads, under the viewer's scope (AG-0.5), with dynamic `server-only` imports.
 */

// ─── shaping (pure) ──────────────────────────────────────────────────────────────────────────────

/** The fields of an application row this card reads. */
export type SalesApplication = {
  caseId: string;
  applicationId: string;
  clientName: string;
  carrierName: string | null;
  productLabel: string | null;
  status: string;
  outcome: string | null;
  monthlyPremiumCents: number | null;
  updatedAt: string;
  submittedAt?: string | null;
  closedAt?: string | null;
};

export type SalesQuote = { caseId: string; createdAt: string; outcome: string };

/** The calendar day (yyyy-mm-dd) of an instant in a time zone. */
export function dayKey(iso: string | number, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The cases worked in the last `days` days, newest first: one row per case (its newest attempt). */
export function recentBusiness<T extends SalesApplication>(rows: readonly T[], nowMs: number, days = 7, limit = 12): T[] {
  const since = nowMs - days * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  const out: T[] = [];
  // A closed case was last worked the day it closed; updated_at also moves with later edits.
  const worked = (row: T) => Date.parse(row.closedAt ?? row.updatedAt);
  for (const row of [...rows].sort((a, b) => worked(b) - worked(a))) {
    const at = worked(row);
    if (!Number.isFinite(at) || at < since || at > nowMs + 60_000) continue;
    if (seen.has(row.caseId)) continue;
    seen.add(row.caseId);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/** Today's quotes (any saved today, discarded ones left out) and sales (applications submitted today). */
export function salesToday(applications: readonly SalesApplication[], quotes: readonly SalesQuote[], nowMs: number, zone: string): { quotes: number; sales: number } {
  const today = dayKey(nowMs, zone);
  return {
    quotes: quotes.filter((quote) => quote.outcome !== "discarded" && dayKey(quote.createdAt, zone) === today).length,
    sales: applications.filter((row) => row.submittedAt && dayKey(row.submittedAt, zone) === today).length,
  };
}

/** Sales (applications submitted) per day over the `days` days before today, in the workspace's zone. */
export function salesAverage(applications: readonly SalesApplication[], nowMs: number, zone: string, days = 14): number {
  const today = dayKey(nowMs, zone);
  const since = dayKey(nowMs - days * 24 * 60 * 60 * 1000, zone);
  const sold = applications.filter((row) => {
    if (!row.submittedAt) return false;
    const day = dayKey(row.submittedAt, zone);
    return day >= since && day < today;
  }).length;
  return sold / days;
}

/** "+1 sale vs your average", or null when today is level with it. */
export function versusAverage(today: number, average: number): { text: string; ahead: boolean } | null {
  const gap = Math.round(today - average);
  if (gap === 0) return null;
  const word = Math.abs(gap) === 1 ? "sale" : "sales";
  return gap > 0 ? { text: `+${gap} ${word} vs your average`, ahead: true } : { text: `${Math.abs(gap)} ${word} under your average`, ahead: false };
}

/** The gauge's top: the best day of the last fortnight, never under today's own count. */
export function gaugeMax(series: ReadonlyArray<{ dials: number | null }>, today: number): number {
  return Math.max(1, today, ...series.map((day) => day.dials ?? 0));
}

// ─── the read (server) ───────────────────────────────────────────────────────────────────────────

export type SalesSnapshot<A extends SalesApplication = SalesApplication> = { applications: A[]; quotes: SalesQuote[] | null };

/** The Applications page's own two lists, under the viewer's scope. Quotes are optional: a failed read is null. */
export async function loadSalesSnapshot(tenantId: string, scope: unknown) {
  const { listApplicationRows, listQuoteRows } = await import("@/lib/applications/lists");
  const narrowed = scope as Parameters<typeof listApplicationRows>[1];
  const [applications, quotes] = await Promise.all([listApplicationRows(tenantId, narrowed), listQuoteRows(tenantId, narrowed).catch(() => null)]);
  return { applications, quotes };
}
