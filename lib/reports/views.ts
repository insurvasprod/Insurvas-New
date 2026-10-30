/**
 * The one Reports page's six views (owner 2026-10-30, canvas artifact "Reports in one page";
 * components/app/reports/reports-page.tsx). A plain module so the server frame and the client rail
 * read one list. Each view keeps its own address, its own gate and its menu key.
 */

/** The Reports menu collapsed or open, remembered for a year; the frame reads it on the server so the page draws at the right width. */
export const REPORTS_RAIL_COOKIE = "insurvas_reports_rail";

export type ReportsView = "sales" | "activity" | "scoring" | "book" | "cpa" | "partner";

export const REPORTS_VIEWS: { key: ReportsView; menuKey: string; label: string; sub: string; href: string; sharesPeriod: boolean }[] = [
  { key: "sales", menuKey: "insight.sales-performance", label: "Sales performance", sub: "Funnel, timing, declines", href: "/app/sales-performance", sharesPeriod: true },
  { key: "activity", menuKey: "insight.activity", label: "Team activity", sub: "Dials and outcomes, by person", href: "/app/activity", sharesPeriod: true },
  { key: "scoring", menuKey: "insight.scoring", label: "Queue scoring", sub: "Scored order against plain", href: "/app/scoring", sharesPeriod: false },
  // Cohorts in months (LA-4.18), not a date window: its own period.
  { key: "book", menuKey: "insight.book-scorecards", label: "Book scorecards", sub: "Persistency and chargebacks", href: "/app/book-scorecards", sharesPeriod: false },
  { key: "cpa", menuKey: "insight.true-cpa", label: "True CPA", sub: "Cost per issued policy", href: "/app/true-cpa", sharesPeriod: true },
  { key: "partner", menuKey: "partners.review", label: "Partner quality", sub: "Lead quality, by partner", href: "/app/partner-quality", sharesPeriod: true },
];

/** The view an address belongs to (a partner's page is Partner quality), or null outside Reports. */
export function reportsViewOf(pathname: string): ReportsView | null {
  return REPORTS_VIEWS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.key ?? null;
}

export function reportsViewLabel(view: ReportsView): string {
  return REPORTS_VIEWS.find((item) => item.key === view)?.label ?? "Reports";
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

/**
 * The period the Reports views share (`?from=YYYY-MM-DD&to=YYYY-MM-DD`), or null when the address
 * carries none or a malformed one. A view with no shared period starts on its own default.
 */
export function sharedPeriod(query: Record<string, string | string[] | undefined> | URLSearchParams): { from: string; to: string } | null {
  const from = query instanceof URLSearchParams ? query.get("from") ?? undefined : single(query.from);
  const to = query instanceof URLSearchParams ? query.get("to") ?? undefined : single(query.to);
  if (!from || !to || !DAY.test(from) || !DAY.test(to) || from > to) return null;
  if (Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) return null;
  return { from, to };
}

/**
 * Keep a view's period in the address, so the rail carries it to the next view and a reload keeps it.
 * Other parameters (a view's tab) stay. Browser only; a failure is not fatal.
 */
export function keepSharedPeriod(period: { from: string; to: string }) {
  if (!DAY.test(period.from) || !DAY.test(period.to)) return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("from") === period.from && url.searchParams.get("to") === period.to) return;
    url.searchParams.set("from", period.from);
    url.searchParams.set("to", period.to);
    window.history.replaceState(null, "",`${url.pathname}${url.search}${url.hash}`);
  } catch { /* the view still shows the period */ }
}
