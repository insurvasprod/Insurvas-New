/**
 * The agency dashboard (Home › Agency, owner 2026-11-06, canvas "Dashboards · by role" round 2 screens 1–2), as drawn:
 *
 *   the strip      issued premium, policies issued, placement, 13-month persistency, chargebacks (the month)
 *   main, row 1    premium submitted and issued by month this year · lead to policy
 *   main, row 2    producer goals · premium by carrier · premium by state
 *   right column   the commission card · received against expected · recent activity
 *
 * Every figure is shaped from a read a page already makes: the Policies list's rows (issue date, premium, carrier,
 * producer), the Applications list (submitted, state), the agency read (chargebacks, override, owed out), the
 * Leads view's funnel, the scorecards' 13-month persistency and the Accounting view's money. Producer goals are not
 * stored anywhere, so each producer's goal is what they issued the month before; the card says so.
 *
 * Two halves, as the other view loaders: the top is pure (no I/O, relative imports) so agency.test.mjs runs it
 * under node; `loadAgencyView` at the bottom reads, with dynamic `server-only` imports, under the viewer's scope.
 */

import { dayKey } from "./sales.ts";
import type { DashViewProps } from "@/components/app/home/views/view-props";

// ─── shaping (pure) ──────────────────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** yyyy-mm of the month `offset` months from the one holding `today` (yyyy-mm-dd). */
export function monthOf(today: string, offset = 0): string {
  const index = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
export const monthName = (key: string) => LONG[Number(key.slice(5, 7)) - 1] ?? key;
export const monthShort = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1] ?? key;

/** The days left in the month holding `today`, today included. */
export function daysLeft(today: string): number {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return last - Number(today.slice(8, 10)) + 1;
}

/** Whole-percent change from `before` to `now`; null when there is nothing to compare against. */
export function pctChange(now: number, before: number): number | null {
  if (!before) return null;
  // `|| 0` turns a rounded -0 into 0, so a flat month never reads "−0%".
  return Math.round(((now - before) / before) * 100) || 0;
}

export type PolicyLite = { issueDate: string | null; annualCents: number | null; carrierId: string; agentUserId: string | null; agentName: string | null };
export type AppLite = { caseId?: string; submittedAt?: string | null; closedAt?: string | null; updatedAt: string; outcome: string | null; status: string; state: string | null; monthlyPremiumCents: number | null };

/**
 * The policies issued in a month (by issue date): how many, and their annual premium. `throughDay` stops at that
 * day of the month, so a month so far compares like for like with the same days of the month before.
 */
export function issuedIn(rows: readonly PolicyLite[], month: string, throughDay?: number): { count: number; cents: number } {
  let count = 0;
  let cents = 0;
  for (const row of rows) {
    if (row.issueDate?.slice(0, 7) !== month) continue;
    if (throughDay !== undefined && Number(row.issueDate.slice(8, 10)) > throughDay) continue;
    count += 1;
    cents += row.annualCents ?? 0;
  }
  return { count, cents };
}

/** The applications submitted in a month, in the workspace's zone. */
export function submittedIn(apps: readonly AppLite[], month: string, zone: string): number {
  return apps.filter((app) => app.submittedAt && dayKey(app.submittedAt, zone).slice(0, 7) === month).length;
}

/**
 * Placement in a month: of the applications submitted that month, the share issued so far. One population on
 * both sides (the Applications list), so it never compares carrier-file policies with applications.
 */
export function placementOf(apps: readonly AppLite[], month: string, zone: string): { issued: number; submitted: number; pct: number } | null {
  const sent = apps.filter((app) => app.submittedAt && dayKey(app.submittedAt, zone).slice(0, 7) === month);
  if (!sent.length) return null;
  const issued = sent.filter((app) => app.outcome === "issued").length;
  return { issued, submitted: sent.length, pct: Math.round((issued / sent.length) * 100) };
}

export type PremiumMonth = { key: string; label: string; issued: number; submitted: number };

/**
 * Premium by month for the year holding `today`, January to this month: issued is the annual premium of the
 * policies issued that month (the Policies list's issue date); submitted the annualised premium of the
 * applications submitted that month.
 */
export function premiumByMonth(rows: readonly PolicyLite[], apps: readonly AppLite[], today: string, zone: string): PremiumMonth[] {
  const year = today.slice(0, 4);
  const upto = Number(today.slice(5, 7));
  const months = Array.from({ length: upto }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
  const issued = new Map(months.map((key) => [key, 0]));
  const submitted = new Map(months.map((key) => [key, 0]));
  for (const row of rows) {
    const key = row.issueDate?.slice(0, 7);
    if (key && issued.has(key)) issued.set(key, (issued.get(key) ?? 0) + (row.annualCents ?? 0));
  }
  for (const app of apps) {
    if (!app.submittedAt) continue;
    const key = dayKey(app.submittedAt, zone).slice(0, 7);
    if (submitted.has(key)) submitted.set(key, (submitted.get(key) ?? 0) + (app.monthlyPremiumCents ?? 0) * 12);
  }
  return months.map((key) => ({ key, label: monthShort(key), issued: issued.get(key) ?? 0, submitted: submitted.get(key) ?? 0 }));
}

/** The annual premium issued from 1 January to `today`'s day of the year, in `year`. */
export function issuedYearToDate(rows: readonly PolicyLite[], year: string, today: string): number {
  const end = `${year}${today.slice(4, 10)}`;
  return rows.reduce((sum, row) => (row.issueDate && row.issueDate >= `${year}-01-01` && row.issueDate <= end ? sum + (row.annualCents ?? 0) : sum), 0);
}

export type GoalRow = { userId: string; name: string; cents: number; goalCents: number; /** Policies issued this month. */ count: number };

/**
 * Each producer's issued premium this month against a goal. No goal is stored, so the goal is what they issued
 * last month; a producer with neither is left out. Biggest share of goal first.
 */
export function producerGoals(rows: readonly PolicyLite[], month: string, previous: string): GoalRow[] {
  const by = new Map<string, GoalRow>();
  for (const row of rows) {
    const key = row.issueDate?.slice(0, 7);
    if (!row.agentUserId || (key !== month && key !== previous)) continue;
    const entry = by.get(row.agentUserId) ?? { userId: row.agentUserId, name: row.agentName ?? "Producer", cents: 0, goalCents: 0, count: 0 };
    if (key === month) { entry.cents += row.annualCents ?? 0; entry.count += 1; }
    else entry.goalCents += row.annualCents ?? 0;
    by.set(row.agentUserId, entry);
  }
  const share = (row: GoalRow) => (row.goalCents ? row.cents / row.goalCents : row.cents ? 1 : 0);
  return [...by.values()].filter((row) => row.cents || row.goalCents).sort((a, b) => share(b) - share(a) || b.cents - a.cents || a.name.localeCompare(b.name));
}

export type StateRow = { key: string; label: string; policies: number; cents: number; trend: "up" | "down" | "flat" };

/**
 * The applications issued this month by the client's state (an issued outcome, dated by its last change), the
 * biggest `top` named and the rest as "Other (n)". The arrow compares each state's count with last month's.
 */
export function premiumByState(apps: readonly AppLite[], month: string, previous: string, zone: string, top = 4, wholeYear = false): StateRow[] {
  const now = new Map<string, { policies: number; cents: number }>();
  const before = new Map<string, number>();
  for (const app of apps) {
    if (app.outcome !== "issued") continue;
    // An issued attempt is dated by the day it closed (its outcome); updated_at moves with any later edit.
    const key = dayKey(app.closedAt ?? app.updatedAt, zone).slice(0, 7);
    const state = app.state || "—";
    if (key === previous) before.set(state, (before.get(state) ?? 0) + 1);
    if (wholeYear ? key.slice(0, 4) === month.slice(0, 4) && key <= month : key === month) {
      const entry = now.get(state) ?? { policies: 0, cents: 0 };
      entry.policies += 1;
      entry.cents += (app.monthlyPremiumCents ?? 0) * 12;
      now.set(state, entry);
    }
  }
  // The arrow is always this month against last month, whatever the period shown.
  const month_ = new Map<string, number>();
  for (const app of apps) if (app.outcome === "issued" && dayKey(app.closedAt ?? app.updatedAt, zone).slice(0, 7) === month) month_.set(app.state || "—", (month_.get(app.state || "—") ?? 0) + 1);
  const trend = (policies: number, last: number, state?: string): StateRow["trend"] => {
    const current = wholeYear && state !== undefined ? month_.get(state) ?? 0 : policies;
    return current > last ? "up" : current < last ? "down" : "flat";
  };
  const sorted = [...now.entries()].sort((a, b) => b[1].cents - a[1].cents || b[1].policies - a[1].policies || a[0].localeCompare(b[0]));
  const named = sorted.slice(0, top).map(([state, entry]) => ({ key: state, label: state, policies: entry.policies, cents: entry.cents, trend: trend(entry.policies, before.get(state) ?? 0, state) }));
  const rest = sorted.slice(top);
  if (rest.length) {
    const policies = rest.reduce((sum, [, entry]) => sum + entry.policies, 0);
    const cents = rest.reduce((sum, [, entry]) => sum + entry.cents, 0);
    const last = rest.reduce((sum, [state]) => sum + (before.get(state) ?? 0), 0);
    const restNow = rest.reduce((sum, [state]) => sum + (month_.get(state) ?? 0), 0);
    named.push({ key: "other", label: `Other (${rest.length})`, policies, cents, trend: wholeYear ? (restNow > last ? "up" : restNow < last ? "down" : "flat") : trend(policies, last) });
  }
  return named;
}

export type FunnelStep = { key: string; label: string; count: number; pct: number };

/**
 * Lead to policy for a month, from the reads the pages make: the leads that came in, those called, the cases
 * quoted, the applications submitted and those issued. A zero a later step exceeds was not counted on that path,
 * so it is left out (as the Leads view's funnel); fewer than two steps is no funnel.
 */
export function leadToPolicy(input: { leads: number | null; called: number | null; quotes: ReadonlyArray<{ caseId: string; createdAt: string; outcome: string }> | null; apps: readonly AppLite[] | null }, month: string, zone: string): { steps: FunnelStep[]; rate: number } | null {
  const inMonth = (iso: string | null | undefined) => Boolean(iso) && dayKey(iso as string, zone).slice(0, 7) === month;
  // One cohort: a case whose application went in this month was quoted, even if the quote is older, so the
  // quoted step always holds the apps step (a funnel never widens).
  const submittedApps = input.apps ? input.apps.filter((app) => inMonth(app.submittedAt)) : null;
  const quoted = input.quotes ? new Set([...input.quotes.filter((quote) => quote.outcome !== "discarded" && inMonth(quote.createdAt)).map((quote) => quote.caseId), ...(submittedApps ?? []).map((app) => app.caseId ?? "")].filter(Boolean)).size : null;
  const submitted = submittedApps ? submittedApps.length : null;
  const issued = input.apps ? input.apps.filter((app) => app.outcome === "issued" && inMonth(app.closedAt ?? app.updatedAt)).length : null;
  const raw = [
    { key: "leads", label: "Leads", count: input.leads },
    { key: "called", label: "Called", count: input.called },
    { key: "quoted", label: "Quoted", count: quoted },
    { key: "apps", label: "Apps", count: submitted },
    { key: "issued", label: "Issued", count: issued },
  ].filter((step): step is { key: string; label: string; count: number } => step.count !== null);
  const kept = raw.filter((step, index) => step.count > 0 || !raw.slice(index + 1).some((later) => later.count > 0));
  if (kept.length < 2 || kept[0].count <= 0) return null;
  // The counts are shown as read; the card draws each bar against the biggest step, so none leaves the card.
  const first = kept[0].count;
  const steps = kept.map((step) => ({ ...step, pct: (step.count / first) * 100 }));
  return { steps, rate: steps[steps.length - 1].pct };
}

// ─── the read (server) ───────────────────────────────────────────────────────────────────────────

/** Pages the cards open, as data (lib/menu: no menu key inside a conditional). */
const AGENCY_PAGES = {
  policies: ["book.policies"],
  applications: ["sell.applications"],
  producers: ["team.producers"],
  discrepancies: ["book.discrepancies"],
  ledger: ["book.ledger"],
  persistency: ["insight.book-scorecards"],
} as const;

export type AgencyPeriod = "this" | "last";

export async function loadAgencyView(props: DashViewProps, period: AgencyPeriod) {
  await import("server-only");
  const [{ firstOpenable }, { readDashboard }, { loadBookView }, { loadLeadsView }, { loadAccountingView }, { readPersistency }, { listApplicationRows, listQuoteRows }] = await Promise.all([
    import("../roleHome.ts"),
    import("@/lib/agency/dashboardStore"),
    import("./book.ts"),
    import("./leads.ts"),
    import("./accounting.ts"),
    import("./retention.ts"),
    import("@/lib/applications/lists"),
  ]);
  const { context, available, solo, zone, now, scope } = props;
  const open = (keys: readonly string[]) => firstOpenable(keys, available, context.role, solo);
  const links = {
    policies: open(AGENCY_PAGES.policies),
    applications: open(AGENCY_PAGES.applications),
    producers: open(AGENCY_PAGES.producers),
    discrepancies: open(AGENCY_PAGES.discrepancies),
    ledger: open(AGENCY_PAGES.ledger),
    persistency: scope === null ? open(AGENCY_PAGES.persistency) : null,
  };
  const today = dayKey(now, zone);
  const month = monthOf(today, period === "this" ? 0 : -1);
  const previous = monthOf(month + "-01", -1);
  const lastDay = (key: string) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const range = (key: string) => ({ from: `${key}-01`, to: lastDay(key) });
  const reader = { tenantId: context.tenantId, userId: context.userId, role: context.memberRole ?? context.role };
  const safe = <T,>(label: string, read: () => Promise<T>): Promise<T | null> => read().catch((error: unknown) => { console.error(`[agency dashboard] ${label}`, error instanceof Error ? error.message : error); return null; });

  const [agency, agencyBefore, book, leads, accounting, persistency, apps, quotes] = await Promise.all([
    safe("agency", () => readDashboard(reader, range(month))),
    safe("agency, month before", () => readDashboard(reader, range(previous))),
    safe("book", () => loadBookView(props)),
    safe("leads", () => loadLeadsView(props)),
    props.noMoney ? null : safe("accounting", () => loadAccountingView(props)),
    links.persistency ? safe("persistency", () => readPersistency(context)) : null,
    links.applications ? safe("applications", () => listApplicationRows(context.tenantId, scope)) : null,
    links.applications ? safe("quotes", () => listQuoteRows(context.tenantId, scope)) : null,
  ]);

  return { today, month, previous, period, links, agency, agencyBefore, book, leads, accounting, persistency, apps, quotes };
}

export type AgencyViewData = Awaited<ReturnType<typeof loadAgencyView>>;
