/**
 * Home › Agency › Compare (owner 2026-11-07, "Build A and B" on the Compare mockups): any two periods side by side,
 * for the whole agency, one person, or up to four people.
 *
 *   A · Periods   the agency (or one person) this period against the last: a strip of figures, the two periods as
 *                 running totals laid over each other, where the change came from, and every person on the same pair
 *   B · People    up to four people on one pair: a card each, a race on issued premium, and dials by day
 *
 * Every figure is counted from the rows its own page lists: dials and contacts from the call log (the Activity page),
 * quotes and applications from the Applications page's lists, policies and premium from the Policies list (by issue
 * date and writing agent). Under the viewer's producer scope (AG-0.5), so a manager compares only his reports.
 *
 * Two halves, as the dashboard views: the top is pure (no I/O, relative imports) so compare.test.mjs runs it under
 * node; `loadCompare` at the bottom reads, with dynamic `server-only` imports.
 */

import { dayKey } from "./views/sales.ts";

// ─── periods: lib/dashboard/comparePeriods.ts (pure, shared with the client controls) ─────────────

import { addDays, daysIn, type PeriodPair, type Range } from "./comparePeriods.ts";
export * from "./comparePeriods.ts";

const DAY = 86_400_000;
const utc = (day: string) => Date.parse(`${day}T00:00:00Z`);

// ─── figures (pure) ──────────────────────────────────────────────────────────────────────────────

/** The rows each figure is counted from, already reduced to who and which day (the workspace's zone). */
export type CompareEvents = {
  calls: ReadonlyArray<{ who: string; day: string; contact: boolean }>;
  quotes: ReadonlyArray<{ who: string; day: string }>;
  apps: ReadonlyArray<{ who: string; day: string; issued: boolean }>;
  policies: ReadonlyArray<{ who: string | null; day: string; cents: number }>;
};

export type Figures = { dials: number; contacts: number; quotes: number; apps: number; appsIssued: number; issued: number; premiumCents: number };
export const EMPTY: Figures = { dials: 0, contacts: 0, quotes: 0, apps: 0, appsIssued: 0, issued: 0, premiumCents: 0 };

const inRange = (day: string, range: Range) => day >= range.from && day <= range.to;

/** Each person's figures in a range, and the total (`""` holds what no person is attached to). */
export function figuresBy(events: CompareEvents, range: Range): { total: Figures; by: Map<string, Figures> } {
  const by = new Map<string, Figures>();
  const total = { ...EMPTY };
  const at = (who: string | null) => {
    const key = who ?? "";
    let row = by.get(key);
    if (!row) by.set(key, (row = { ...EMPTY }));
    return row;
  };
  for (const c of events.calls) if (inRange(c.day, range)) { const r = at(c.who); r.dials += 1; total.dials += 1; if (c.contact) { r.contacts += 1; total.contacts += 1; } }
  for (const q of events.quotes) if (inRange(q.day, range)) { at(q.who).quotes += 1; total.quotes += 1; }
  for (const a of events.apps) if (inRange(a.day, range)) { const r = at(a.who); r.apps += 1; total.apps += 1; if (a.issued) { r.appsIssued += 1; total.appsIssued += 1; } }
  for (const p of events.policies) if (inRange(p.day, range)) { const r = at(p.who); r.issued += 1; r.premiumCents += p.cents; total.issued += 1; total.premiumCents += p.cents; }
  return { total, by };
}

export const placement = (f: Figures) => (f.apps ? Math.round((f.appsIssued / f.apps) * 100) : null);
export const contactRate = (f: Figures) => (f.dials ? Math.round((f.contacts / f.dials) * 100) : null);

/** Whole-percent change; null when there is nothing to compare against. `|| 0` keeps a flat change from reading −0. */
export function change(now: number, then: number): number | null {
  if (!then) return null;
  return Math.round(((now - then) / then) * 100) || 0;
}

/**
 * How a change reads (critique #2): a percentage off a tiny base ("+5,900%") says nothing, so from nothing it is
 * "new", ten times or more is "12×", and otherwise the whole-percent change. Null when both are zero.
 */
export type ChangeRead = { kind: "pct"; value: number } | { kind: "times"; text: string } | { kind: "new" } | null;
export function changeRead(now: number, then: number): ChangeRead {
  if (!then) return now > 0 ? { kind: "new" } : null;
  if (now > 0 && now / then >= 10) return { kind: "times", text: `${Math.round(now / then)}×` };
  const pct = change(now, then);
  return pct ? { kind: "pct", value: pct } : null;
}

/** Initials for a person's mark: "Devin Okafor" → "DO". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export type Metric = "premium" | "policies" | "dials";

/** A running total for each day of the range (day 1, day 2, …), for one person or everyone (`who` undefined). */
export function running(events: CompareEvents, range: Range, metric: Metric, who?: string): number[] {
  const n = daysIn(range);
  const daily = new Array<number>(n).fill(0);
  const index = (day: string) => Math.round((utc(day) - utc(range.from)) / DAY);
  const mine = (w: string | null) => who === undefined || w === who;
  if (metric === "dials") for (const c of events.calls) { if (inRange(c.day, range) && mine(c.who)) daily[index(c.day)] += 1; }
  else for (const p of events.policies) { if (inRange(p.day, range) && mine(p.who)) daily[index(p.day)] += metric === "premium" ? p.cents : 1; }
  let sum = 0;
  return daily.map((v) => (sum += v));
}

/** One person's daily figure across the range (not running), for the table's Trend sparkline. */
export function dailyFor(events: CompareEvents, range: Range, metric: Metric, who: string): number[] {
  const total = running(events, range, metric, who);
  return total.map((value, index) => value - (total[index - 1] ?? 0));
}

/** Dials per day of the range for one person (the B grid). */
export function dialsByDay(events: CompareEvents, range: Range, who: string): number[] {
  const n = daysIn(range);
  const daily = new Array<number>(n).fill(0);
  for (const c of events.calls) if (c.who === who && inRange(c.day, range)) daily[Math.round((utc(c.day) - utc(range.from)) / DAY)] += 1;
  return daily;
}

/** Each person's change in issued premium, biggest gain first: "where the change came from". */
export function changeBy(now: Map<string, Figures>, then: Map<string, Figures>): Array<{ who: string; cents: number }> {
  const people = new Set([...now.keys(), ...then.keys()].filter(Boolean));
  return [...people].map((who) => ({ who, cents: (now.get(who)?.premiumCents ?? 0) - (then.get(who)?.premiumCents ?? 0) })).filter((row) => row.cents !== 0).sort((x, y) => y.cents - x.cents);
}

// ─── the read (server) ───────────────────────────────────────────────────────────────────────────

/** A contact is any call that reached someone (the dashboards' rule: lib/dashboard/todayMath NOT_A_CONTACT). */
const NOT_A_CONTACT = new Set(["no_answer", "voicemail", "busy", "call_dropped", "disconnected", "wrong_number"]);

export type CompareViewer = { tenantId: string; userId: string; role: string; scope: readonly string[] | null; zone: string };

/** Every row the two periods need, read once for the span from the earlier start to the later end. */
export async function loadCompare(viewer: CompareViewer, pair: PeriodPair): Promise<{ events: CompareEvents; names: Map<string, string> }> {
  await import("server-only");
  const [{ getSupabaseServiceClient }, { scopeQuery }, bookStore, { isSchemaGap }] = await Promise.all([
    import("@/lib/supabase/service"),
    import("@/lib/agency/visibility"),
    import("@/lib/ingestion/policyBookStore"),
    import("@/lib/supabase/schemaGap"),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- columns read here are not all in the generated types
  const db = (): any => getSupabaseServiceClient();
  const from = [pair.a.from, pair.b.from].sort()[0];
  const to = [pair.a.to, pair.b.to].sort()[1];
  // A day in the workspace's zone can start up to 14 hours either side of UTC midnight: read a day wider, then keep
  // each row by its own local day.
  const lo = `${addDays(from, -1)}T00:00:00Z`;
  const hi = `${addDays(to, 2)}T00:00:00Z`;
  // Every row, 1,000 a request. The first page alone (most reads fit in it); past a full page, the next three at once
  // rather than one after another (perf pass 2026-11-08: a month of dials was three round trips in a row).
  type Page<T> = { data: T[] | null; error: { message: string } | null };
  const pages = async <T,>(build: () => { range: (a: number, b: number) => PromiseLike<Page<T>> }, max = 40_000): Promise<T[]> => {
    const read = async (start: number) => {
      const { data, error } = await build().range(start, start + 999);
      // The code rides along, so a view a pending migration has not created yet reads as a gap (tolerate), not a fault.
      if (error) throw Object.assign(new Error(error.message), { code: (error as { code?: string }).code });
      return data ?? [];
    };
    const out: T[] = await read(0);
    for (let start = 1000; out.length === start && start < max; start += 3000) {
      const batch = await Promise.all([start, start + 1000, start + 2000].filter((at) => at < max).map(read));
      for (const rows of batch) {
        out.push(...rows);
        if (rows.length < 1000) return out;
      }
    }
    return out;
  };
  // The book, for policies issued in the span: only the three figures Compare draws (who, the issue day, the annual
  // premium), not the whole Book of business with its names, notes and saved filters (perf pass 2026-11-08). The same
  // rows and the same scope as loadBook / loadHandPolicies; a row whose issue day is before the span is left out in
  // the query, the rest by the exact filter below.
  const tolerate = <T,>(rows: Promise<T[]>) => rows.catch((error: unknown) => {
    if (error instanceof Error && isSchemaGap(error as Error & { code?: string })) return [] as T[];
    throw error;
  });
  const producerOnly = viewer.role === "producer";
  const carrierRows = () => tolerate(pages<{ agent_user_id: string | null; issued_on: string | null; issue_date: string | null; annualised_premium_cents: number | null }>(() => {
    let query = db().from("policy_current").select("agent_user_id, issued_on, issue_date, annualised_premium_cents").eq("tenant_id", viewer.tenantId).or(`issued_on.gte.${from},issue_date.gte.${from}`);
    if (producerOnly) query = query.eq("agent_user_id", viewer.userId);
    return scopeQuery(query, "agent_user_id", scoped).order("carrier_id").order("policy_number");
  }, 50_000));
  const handRows = () => tolerate(pages<{ effective_date: string | null; annual_premium_cents: number | null }>(() => {
    let query = db().from("tenant_policies").select("effective_date, annual_premium_cents").eq("tenant_id", viewer.tenantId).gte("effective_date", from);
    if (producerOnly) query = query.eq("created_by", viewer.userId);
    return scopeQuery(query, "created_by", scoped).order("id");
  }, 50_000));
  const local = (iso: string) => dayKey(iso, viewer.zone);
  const scoped = viewer.scope;
  const booker = { tenantId: viewer.tenantId, userId: viewer.userId, role: viewer.role, scope: viewer.scope };

  const [calls, quotes, apps, carrierBook, hand, issued] = await Promise.all([
    pages<{ agent_id: string | null; attempted_at: string; disposition: string | null }>(() => scopeQuery(db().from("tenant_call_attempts").select("agent_id, attempted_at, disposition").eq("tenant_id", viewer.tenantId).gte("attempted_at", lo).lt("attempted_at", hi), "agent_id", scoped).order("attempted_at").order("id")),
    pages<{ created_by: string | null; created_at: string; status: string }>(() => scopeQuery(db().from("tenant_quotes").select("created_by, created_at, status").eq("tenant_id", viewer.tenantId).gte("created_at", lo).lt("created_at", hi), "created_by", scoped).order("created_at").order("id")),
    pages<{ created_by: string | null; submitted_at: string | null; outcome: string | null }>(() => scopeQuery(db().from("tenant_applications").select("created_by, submitted_at, outcome").eq("tenant_id", viewer.tenantId).gte("submitted_at", lo).lt("submitted_at", hi), "created_by", scoped).order("submitted_at").order("id")),
    carrierRows(),
    handRows(),
    // Sales recorded but not yet in a carrier file, issued in the span; no client names (Compare never shows them).
    bookStore.loadIssuedAwaiting(booker, { since: from, lean: true }),
  ]);

  const rows: Array<{ issueDate: string | null; agentUserId: string | null; agentName: string | null; annualCents: number | null }> = [
    ...carrierBook.map((r) => ({ issueDate: r.issued_on ?? r.issue_date ?? null, agentUserId: r.agent_user_id, agentName: null, annualCents: r.annualised_premium_cents })),
    ...hand.map((r) => ({ issueDate: r.effective_date ?? null, agentUserId: null, agentName: null, annualCents: r.annual_premium_cents })),
    ...issued,
  ];
  const events: CompareEvents = {
    calls: calls.filter((c) => c.agent_id).map((c) => ({ who: c.agent_id as string, day: local(c.attempted_at), contact: Boolean(c.disposition) && !NOT_A_CONTACT.has(c.disposition as string) })),
    quotes: quotes.filter((q) => q.created_by && q.status !== "discarded").map((q) => ({ who: q.created_by as string, day: local(q.created_at) })),
    apps: apps.filter((a) => a.created_by && a.submitted_at).map((a) => ({ who: a.created_by as string, day: local(a.submitted_at as string), issued: a.outcome === "issued" })),
    policies: rows.filter((r) => r.issueDate && r.issueDate >= from && r.issueDate <= to).map((r) => ({ who: r.agentUserId, day: (r.issueDate as string).slice(0, 10), cents: r.annualCents ?? 0 })),
  };

  // Everyone the rows name, by their account name.
  const ids = [...new Set([...events.calls.map((c) => c.who), ...events.quotes.map((q) => q.who), ...events.apps.map((a) => a.who), ...events.policies.map((p) => p.who).filter((w): w is string => Boolean(w))])];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db().from("users").select("id, name, email").in("id", ids.slice(i, i + 200));
    for (const user of (data ?? []) as Array<{ id: string; name: string | null; email: string | null }>) names.set(user.id, user.name || user.email || "Someone");
  }
  for (const row of rows) if (row.agentUserId && row.agentName && !names.has(row.agentUserId)) names.set(row.agentUserId, row.agentName);
  return { events, names };
}
