/**
 * The Leads view of /app/dashboard (?view=leads, owner 2026-11-06): what is waiting on the reader in the
 * lead flow, leads in against leads called this month, where the leads came from, how far they went,
 * the vendors behind them, and how fast the newest ones were called.
 *
 * Server only. Every database read is a dynamic import inside `loadLeadsView`, and each of those modules
 * reads through the service client, so nothing here reaches a browser bundle; the pure helpers above it
 * import only relative, database-free modules, so leads.test.mjs runs them under plain node.
 *
 * The rules every view keeps (components/app/home/views/view-props.ts):
 *   - AG-0.5: every read honours `scope` exactly as the page behind it does. The agency-only pages
 *     (duplicates, import, vendors, true CPA, vendor bills) refuse a narrow session, so their figures are
 *     not read for one; the lead workspace and the dialer narrow to the scope, and so do these reads.
 *   - A figure is shown only when its page is open to the reader (`firstOpenable`, less hidden pages).
 *   - Money (lead spend, cost per sale) needs money.view, no `noMoney`, and no producer scope: inside an
 *     agency a producer does not see lead cost (AG-0.2).
 *   - Any read that fails leaves its part null; nothing here throws.
 */
import type { DashViewProps } from "@/components/app/home/views/view-props";
import type { DashItem, DashNeed, DashRow, DashStep } from "@/components/app/home/dash/dash-kit";
import type { TenantRole } from "../../tenantAuth/roles.ts";
import { firstOpenable } from "../roleHome.ts";
import { localRangeToUtc } from "../../dealFlow/localDate.ts";
import { anyRoleHasPermission } from "../../tenantAuth/permissions.ts";

/* ── Pure helpers (tested in leads.test.mjs) ─────────────────────────────────────────────────── */

/** A row cap per paged read: a month past it is reported as capped, never silently cut. */
export const MAX_ROWS = 20_000;
/** "Not called" means routed to someone this long ago with no dial yet. */
export const NOT_CALLED_AFTER_MS = 2 * 60 * 60 * 1000;

/** The local date (YYYY-MM-DD) of an instant in `zone`. */
export function dayOf(at: string | number | Date, zone: string): string {
  const date = at instanceof Date ? at : new Date(at);
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** This month so far in `zone`: the first day, today, and every day between (inclusive). */
export function monthSoFar(now: number, zone: string): { from: string; to: string; days: string[] } {
  const to = dayOf(now, zone);
  const [year, month, day] = to.split("-").map(Number);
  const pad = (value: number) => String(value).padStart(2, "0");
  const days = Array.from({ length: day }, (_, index) => `${year}-${pad(month)}-${pad(index + 1)}`);
  return { from: days[0], to, days };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 6" for 2026-11-06. */
export function shortDay(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${MONTHS[month - 1]} ${date}`;
}

export type Point = { key: string; label: string; value: number };

/**
 * Leads in and leads called per day. `arrived` is one local day per lead that came in; `called` is one
 * (local day, lead) per dial click, so a lead dialled three times in a day counts once that day.
 */
export function dailySeries(days: readonly string[], arrived: readonly string[], called: ReadonlyArray<{ day: string; leadId: string }>): { leadsIn: Point[]; leadsCalled: Point[] } {
  const inCount = new Map<string, number>();
  for (const day of arrived) inCount.set(day, (inCount.get(day) ?? 0) + 1);
  const calledSets = new Map<string, Set<string>>();
  for (const row of called) {
    const set = calledSets.get(row.day) ?? new Set<string>();
    set.add(row.leadId);
    calledSets.set(row.day, set);
  }
  return {
    leadsIn: days.map((day) => ({ key: day, label: shortDay(day), value: inCount.get(day) ?? 0 })),
    leadsCalled: days.map((day) => ({ key: day, label: shortDay(day), value: calledSets.get(day)?.size ?? 0 })),
  };
}

export type SourceLead = { campaign_id: string | null; partner_id: string | null; first_dial_at?: string | null };
/** `called`: of those leads, the ones dialled at least once. */
export type SourceSlice = { key: string; label: string; value: number; called: number };

/** The most slices the donut draws; the rest fold into "Other sources". */
export const MAX_SLICES = 5;

/**
 * Leads by where they came from: a campaign's vendor (by name), else the campaign itself, partner
 * transfers, and leads with neither. Largest first; past MAX_SLICES the smallest fold into one slice.
 */
export function sourceSlices(leads: readonly SourceLead[], campaigns: ReadonlyMap<string, { name: string; vendorId: string | null }>, vendors: ReadonlyMap<string, string>): SourceSlice[] {
  const groups = new Map<string, SourceSlice>();
  for (const lead of leads) {
    const campaign = lead.campaign_id ? campaigns.get(lead.campaign_id) : undefined;
    const [key, label] = campaign?.vendorId && vendors.has(campaign.vendorId)
      ? [`vendor:${campaign.vendorId}`, vendors.get(campaign.vendorId)!]
      : campaign && lead.campaign_id ? [`campaign:${lead.campaign_id}`, campaign.name]
        : lead.partner_id ? ["partner", "Partner transfers"] : ["none", "No vendor or campaign"];
    const slice = groups.get(key) ?? { key, label, value: 0, called: 0 };
    slice.value += 1;
    if (lead.first_dial_at) slice.called += 1;
    groups.set(key, slice);
  }
  const sorted = [...groups.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  if (sorted.length <= MAX_SLICES) return sorted;
  const kept = sorted.slice(0, MAX_SLICES - 1);
  const rest = sorted.slice(MAX_SLICES - 1);
  return [...kept, { key: "other", label: "Other sources", value: rest.reduce((sum, slice) => sum + slice.value, 0), called: rest.reduce((sum, slice) => sum + slice.called, 0) }];
}

/**
 * Where one source opens: a vendor's own page (/app/campaigns/vendors/<id>) or a campaign's
 * (/app/campaigns/<id>) when the reader opens Vendors & campaigns; else the fallback (the lead workspace).
 */
export function sourceHref(key: string, vendorsPage: string | null, fallback: string): string {
  if (vendorsPage && key.startsWith("vendor:")) return `${vendorsPage}/vendors/${key.slice(7)}`;
  if (vendorsPage && key.startsWith("campaign:")) return `${vendorsPage}/${key.slice(9)}`;
  return fallback;
}

/** Whether this reader sees money on this view: money.view, not a manager, not narrowed inside an agency. */
export function seesLeadMoney(input: { roles: readonly TenantRole[]; noMoney: boolean; scope: readonly string[] | null }): boolean {
  return !input.noMoney && input.scope === null && anyRoleHasPermission(input.roles, "money.view");
}

/** Whole dollars, for a dashboard figure ("$1,240"). */
export function dollars(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(Math.round(cents / 100));
}

/** "45s", "12m", "3h 5m", "2d 4h". */
export function durationLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

export type NeedCounts = {
  notCalled: { count: number; capped: boolean; href: string } | null;
  duplicates: { count: number; href: string } | null;
  missing: { state: number | null; phone: number | null; href: (column: "state" | "phone") => string } | null;
  review: { count: number; href: string } | null;
  bills: { count: number; flagged: number; href: string } | null;
};

/**
 * Needs you, most urgent first: a routed lead nobody has called is a sale going cold; a duplicate is a
 * lead paid for twice; a lead with no state or phone cannot be dialled; a staged file is leads not in
 * yet; a vendor bill to check is money, not a lead. A count that was not read is left out.
 */
export function leadNeeds(counts: NeedCounts): DashNeed[] {
  const n = (value: number) => value.toLocaleString("en-US");
  const items: DashNeed[] = [];
  if (counts.notCalled) items.push({ key: "not-called", count: counts.notCalled.count, label: "Leads not called", detail: counts.notCalled.capped ? "at least this many, routed over 2h ago" : "routed over 2h ago, no dial yet", tone: "danger", href: counts.notCalled.href });
  if (counts.duplicates) items.push({ key: "duplicates", count: counts.duplicates.count, label: "Possible duplicates", detail: "waiting for a decision", tone: "warning", href: counts.duplicates.href });
  if (counts.missing) {
    const { state, phone } = counts.missing;
    if (state) items.push({ key: "missing", count: state, label: "Leads with no state", detail: phone ? `${n(phone)} with no phone` : "no calling window, never served", tone: "warning", href: counts.missing.href("state") });
    else if (phone) items.push({ key: "missing", count: phone, label: "Leads with no phone", detail: "nothing to dial", tone: "warning", href: counts.missing.href("phone") });
  }
  if (counts.review) items.push({ key: "review", count: counts.review.count, label: "Lists not finished", detail: "imported, waiting for review", tone: "info", href: counts.review.href });
  if (counts.bills) items.push({ key: "bills", count: counts.bills.count, label: "Vendor bills to check", detail: counts.bills.flagged ? `${n(counts.bills.flagged)} differ from our count` : "to approve", tone: counts.bills.flagged ? "warning" : "neutral", href: counts.bills.href });
  return items;
}

/** Steps as funnel bars: each step's share of the first. A step that was not counted (null) is left out. */
export function funnelSteps(raw: ReadonlyArray<{ key: string; label: string; count: number | null }>, href: string | null): { steps: DashStep[]; rate: string } | null {
  const read = raw.filter((step): step is { key: string; label: string; count: number } => step.count !== null);
  // A zero a later step exceeds was not counted on that path (applications taken without a dial): a funnel
  // never dips to nothing and climbs back, so that step is left out rather than drawn as 0%.
  const counted = read.filter((step, index) => step.count > 0 || !read.slice(index + 1).some((later) => later.count > 0));
  if (counted.length < 2) return null;
  const first = counted[0].count;
  const steps = counted.map((step) => ({ key: step.key, label: step.label, count: step.count, pct: first > 0 ? (step.count / first) * 100 : 0, ...(href ? { href } : {}) }));
  const last = steps[steps.length - 1];
  const rate = first > 0 ? `${last.pct < 10 ? last.pct.toFixed(1) : Math.round(last.pct)}% ${last.label.toLowerCase()}` : "No leads yet";
  return { steps, rate };
}

export type VendorLine = { id: string; name: string; leads: number; reachedPct: number | null; costPerSaleCents: number | null; testBatch: boolean };

/** The vendors table: largest by leads first, test batches out, at most six; the cost column only with money. */
export function vendorTable(lines: readonly VendorLine[], money: boolean, hrefFor: (id: string) => string | null): { heads: string[]; rows: DashRow[] } {
  const heads = money ? ["Vendor", "Leads", "Reached", "Cost / sale"] : ["Vendor", "Leads", "Reached"];
  const rows = lines
    .filter((line) => !line.testBatch && line.leads > 0)
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name))
    .slice(0, 6)
    .map((line) => {
      const cells = [line.name, line.leads.toLocaleString("en-US"), line.reachedPct === null ? "—" : `${Math.round(line.reachedPct)}%`];
      if (money) cells.push(line.costPerSaleCents === null ? "—" : dollars(line.costPerSaleCents));
      const href = hrefFor(line.id);
      return { key: line.id, cells, ...(href ? { href } : {}) };
    });
  return { heads, rows };
}

export type SpeedLead = { id: string; name: string; arrivedAt: string; firstDialAt: string | null };

/** Speed to lead: each new lead with the time from arrival to its first dial, or how long it has waited. */
export function speedItems(leads: readonly SpeedLead[], now: number, hrefFor: (id: string) => string): DashItem[] {
  return leads.map((lead) => {
    const arrived = Date.parse(lead.arrivedAt);
    const dialled = lead.firstDialAt ? Date.parse(lead.firstDialAt) : NaN;
    const initials = lead.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
    if (!Number.isNaN(dialled) && dialled >= arrived) {
      const seconds = (dialled - arrived) / 1000;
      return { key: lead.id, mark: initials, tone: seconds <= 300 ? "good" : seconds <= 3600 ? "warning" : "danger", title: lead.name, detail: "first dial", value: durationLabel(seconds), when: `arrived ${durationLabel((now - arrived) / 1000)} ago`, href: hrefFor(lead.id) };
    }
    const waited = (now - arrived) / 1000;
    return { key: lead.id, mark: initials, tone: waited * 1000 > NOT_CALLED_AFTER_MS ? "danger" : "neutral", title: lead.name, detail: "not called yet", value: durationLabel(waited), when: "waiting", href: hrefFor(lead.id) };
  });
}

/** A lead's display name from its template values. */
export function leadName(values: Record<string, unknown> | null | undefined): string {
  const text = (key: string) => (typeof values?.[key] === "string" ? (values[key] as string).trim() : "");
  return text("full_name") || text("name") || [text("first_name"), text("last_name")].filter(Boolean).join(" ") || "Unnamed lead";
}

/* ── The view's data ─────────────────────────────────────────────────────────────────────────── */

export type LeadsViewData = {
  needs: DashNeed[] | null;
  chart: { leadsIn: Point[]; leadsCalled: Point[]; totalIn: number; totalCalled: number; capped: boolean; href: string } | null;
  sources: { slices: Array<SourceSlice & { href: string | null }>; total: number; href: string } | null;
  funnel: { title: string; steps: DashStep[]; rate: string; href: string | null; source: "scorecard" | "dial" | "leads" } | null;
  vendors: { heads: string[]; rows: DashRow[]; href: string | null; source: "scorecard" | "leads" } | null;
  hero:
    | { kind: "spend"; spendCents: number; costPerSaleCents: number | null; costPerLeadCents: number | null; issued: number; href: string }
    | { kind: "ready"; ready: number; href: string }
    | { kind: "in"; leadsIn: number; called: number; href: string }
    | null;
  speed: { items: DashItem[]; href: string } | null;
  period: { from: string; to: string };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- several columns read here are not in the generated types
type Db = any;
type Rows<T> = { rows: T[]; capped: boolean };

async function paged<T>(build: () => Db, cap = MAX_ROWS): Promise<Rows<T>> {
  const rows: T[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < 1000) return { rows, capped: false };
  }
  return { rows, capped: true };
}

const settle = <T,>(work: () => Promise<T>): Promise<T | null> => work().catch(() => null);

export async function loadLeadsView(props: DashViewProps): Promise<LeadsViewData> {
  const { context, available, scope, solo, zone, now, noMoney } = props;
  const tenantId = context.tenantId;
  const roles: TenantRole[] = context.roles?.length ? context.roles : [context.role];
  const hidden = context.hiddenPages ?? [];
  const opener = (keys: readonly string[]) => firstOpenable(keys.filter((key) => !hidden.includes(key)), available, context.role, solo);
  const agencyWide = scope === null;
  const money = seesLeadMoney({ roles, noMoney, scope });
  const month = monthSoFar(now, zone);
  const range = localRangeToUtc(month.from, month.to, zone);

  const workspace = opener(["leads.workspace"]);
  const dialer = opener(["leads.dialer"]);
  const duplicatesPage = agencyWide ? opener(["leads.duplicates"]) : null;
  const importPage = agencyWide ? opener(["leads.import"]) : null;
  const vendorsPage = agencyWide ? opener(["leads.campaigns"]) : null;
  const trueCpaPage = agencyWide ? opener(["insight.true-cpa"]) : null;
  const billsPage = agencyWide ? opener(["accounting.invoices"]) : null;
  const dealFlowPage = opener(["sell.deal-flow"]);
  const trueCpaHref = trueCpaPage ? `${trueCpaPage}?from=${month.from}&to=${month.to}` : null;

  const [{ getSupabaseServiceClient }, { visibleLeadSet }] = await Promise.all([
    import("@/lib/supabase/service"),
    import("@/lib/agentTemplates/service"),
  ]);
  const db = () => getSupabaseServiceClient() as Db;
  const scoped = (query: Db, column: string) => (scope === null ? query : query.in(column, scope.length ? scope : ["00000000-0000-0000-0000-000000000000"]));
  // AG-0.5: the leads a narrow session may see (decision D1), read once and shared by every lead read.
  const visibleRead = workspace || dialer ? settle(() => visibleLeadSet(tenantId, scope)) : Promise.resolve(null);

  /* Needs you */
  const needsRead = settle(async (): Promise<DashNeed[]> => {
    const { readStepCounts, readLatestReviewBatch } = await import("@/lib/leadSources/stepCounts");
    const steps = await readStepCounts({ tenantId, roles, available, narrow: !agencyWide, hidden, solo, now }).catch(() => ({} as Record<string, number>));
    const counts: NeedCounts = { notCalled: null, duplicates: null, missing: null, review: null, bills: null };

    const notCalledHref = opener(["leads.workspace", "leads.dialer"]);
    const tasks: Array<Promise<void>> = [];
    if (notCalledHref) tasks.push(settle(async () => {
      // Routed to someone (an owner on the open queue row) over two hours ago, and never dialled.
      const cutoff = new Date(now - NOT_CALLED_AFTER_MS).toISOString();
      const queued = await paged<{ lead_id: string }>(() => scoped(db().from("lead_queue").select("lead_id").eq("tenant_id", tenantId).in("status", ["unclaimed", "claimed"]).not("owner_user_id", "is", null).lt("queued_at", cutoff).order("queued_at", { ascending: true }), "owner_user_id"), 5000);
      const ids = [...new Set(queued.rows.map((row) => row.lead_id))];
      let count = 0;
      for (let index = 0; index < ids.length; index += 300) {
        const chunk = ids.slice(index, index + 300);
        const result = await db().from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("id", chunk).is("first_dial_at", null);
        if (result.error) throw new Error(result.error.message);
        count += result.count ?? 0;
      }
      counts.notCalled = { count, capped: queued.capped, href: notCalledHref };
    }).then(() => undefined));
    if (duplicatesPage && typeof steps.clean === "number") counts.duplicates = { count: steps.clean, href: `${duplicatesPage}?tab=duplication` };
    if (duplicatesPage && typeof steps.clean === "number") tasks.push(settle(async () => {
      const { countMissingData } = await import("@/lib/leadDuplicates/missingDataService");
      const missing = await countMissingData(tenantId);
      counts.missing = { state: missing.state, phone: missing.phone, href: (column) => `${duplicatesPage}?tab=missing&missing=${column}` };
    }).then(() => undefined));
    if (importPage && typeof steps.review === "number") tasks.push(settle(async () => {
      const batch = steps.review ? await readLatestReviewBatch(tenantId, now).catch(() => null) : null;
      counts.review = { count: steps.review!, href: batch ? `/app/import/review/${batch}` : importPage };
    }).then(() => undefined));
    if (billsPage) tasks.push(settle(async () => {
      const [{ listInvoices }, { EDITABLE }] = await Promise.all([import("@/lib/accounting/invoiceStore"), import("@/lib/accounting/invoicesCore")]);
      const open = await listInvoices(tenantId, { status: "open" });
      const toCheck = open.filter((invoice) => EDITABLE.includes(invoice.status));
      counts.bills = { count: toCheck.length, flagged: toCheck.filter((invoice) => invoice.flagged).length, href: `${billsPage}?tab=invoices&status=approve` };
    }).then(() => undefined));
    await Promise.all(tasks);
    return leadNeeds(counts);
  });

  /* This month's leads: the chart, the donut, and the leads-only fallbacks */
  type MonthLead = { id: string; created_at: string; first_dial_at: string | null; campaign_id: string | null; partner_id: string | null };
  const monthRead = workspace ? settle(async () => {
    const [leads, calls, visible] = await Promise.all([
      paged<MonthLead>(() => db().from("agent_leads").select("id, created_at, first_dial_at, campaign_id, partner_id").eq("tenant_id", tenantId).gte("created_at", range.gte).lt("created_at", range.lt).order("created_at", { ascending: true })),
      paged<{ lead_id: string; dial_clicked_at: string }>(() => scoped(db().from("tenant_call_attempts").select("lead_id, dial_clicked_at").eq("tenant_id", tenantId).gte("attempted_at", range.gte).lt("attempted_at", range.lt).not("dial_clicked_at", "is", null).order("attempted_at", { ascending: true }), "agent_id")),
      visibleRead,
    ]);
    if (scope !== null && visible === null) throw new Error("scope unavailable");
    const mine = visible ? leads.rows.filter((lead) => visible.has(lead.id)) : leads.rows;
    return { leads: mine, calls: calls.rows, capped: leads.capped || calls.capped };
  }) : Promise.resolve(null);

  /* The vendor scorecard: funnel, vendors and spend (agency-wide only, the true CPA page's gate) */
  const scorecardRead = trueCpaPage ? settle(async () => {
    const { getVendorScorecard } = await import("@/lib/vendorScorecard/service");
    return getVendorScorecard(tenantId, { from: month.from, to: month.to }, true);
  }) : Promise.resolve(null);

  /* Speed to lead: the newest leads (a narrow session's own, from the newest 300) */
  const speedRead = workspace ? settle(async () => {
    const visible = await visibleRead;
    if (scope !== null && visible === null) throw new Error("scope unavailable");
    const { data, error } = await db().from("agent_leads").select("id, created_at, posted_at, first_dial_at, values").eq("tenant_id", tenantId).is("values->>_erased", null).order("created_at", { ascending: false }).limit(visible ? 300 : 8);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as Array<{ id: string; created_at: string; posted_at: string | null; first_dial_at: string | null; values: Record<string, unknown> | null }>)
      .filter((row) => !visible || visible.has(row.id))
      .slice(0, 8);
    return rows.map((row) => ({ id: row.id, name: leadName(row.values), arrivedAt: row.posted_at ?? row.created_at, firstDialAt: row.first_dial_at }));
  }) : Promise.resolve(null);

  /* Ready to dial: the non-money hero */
  const readyRead = !money && dialer ? settle(async () => {
    const result = await scoped(db().from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "unclaimed").is("partner_id", null), "owner_user_id");
    if (result.error) throw new Error(result.error.message);
    return (result.count ?? 0) as number;
  }) : Promise.resolve(null);

  const [needs, monthData, scorecard, speed, ready] = await Promise.all([needsRead, monthRead, scorecardRead, speedRead, readyRead]);

  /* Names behind the donut (vendor, else campaign) */
  const names = monthData && monthData.leads.some((lead) => lead.campaign_id) ? await settle(async () => {
    const [campaigns, vendors] = await Promise.all([
      db().from("tenant_campaigns").select("id, name, vendor_id").eq("tenant_id", tenantId),
      db().from("tenant_lead_vendors").select("id, name").eq("tenant_id", tenantId),
    ]);
    if (campaigns.error || vendors.error) throw new Error("names unavailable");
    return {
      campaigns: new Map(((campaigns.data ?? []) as Array<{ id: string; name: string | null; vendor_id: string | null }>).map((row) => [row.id, { name: row.name ?? "Campaign", vendorId: row.vendor_id }])),
      vendors: new Map(((vendors.data ?? []) as Array<{ id: string; name: string | null }>).map((row) => [row.id, row.name ?? "Vendor"])),
    };
  }) : { campaigns: new Map<string, { name: string; vendorId: string | null }>(), vendors: new Map<string, string>() };

  const chart = monthData && workspace ? (() => {
    const series = dailySeries(month.days, monthData.leads.map((lead) => dayOf(lead.created_at, zone)), monthData.calls.map((call) => ({ day: dayOf(call.dial_clicked_at, zone), leadId: call.lead_id })));
    const calledLeads = new Set(monthData.calls.map((call) => call.lead_id));
    return { ...series, totalIn: monthData.leads.length, totalCalled: calledLeads.size, capped: monthData.capped, href: workspace };
  })() : null;

  const sources = monthData && workspace && names && monthData.leads.length
    ? { slices: sourceSlices(monthData.leads, names.campaigns, names.vendors).map((slice) => ({ ...slice, href: sourceHref(slice.key, vendorsPage, workspace) })), total: monthData.leads.length, href: vendorsPage ? `${vendorsPage}/vendors` : workspace }
    : null;

  /* Funnel: the scorecard's lead → issued, else the deal-flow funnel, else what this view itself counted */
  let funnel: LeadsViewData["funnel"] = null;
  if (scorecard) {
    const t = scorecard.totals;
    const built = funnelSteps([
      { key: "leads", label: "Leads", count: t.leads_received },
      { key: "reached", label: "Reached", count: t.contacted_leads },
      { key: "quoted", label: "Quoted", count: t.quoted_leads },
      { key: "apps", label: "Apps", count: t.applied_leads ?? t.applications },
      { key: "issued", label: "Issued", count: t.issued_policies },
    ], trueCpaHref);
    if (built && t.leads_received > 0) funnel = { title: "Lead to policy", ...built, href: trueCpaHref, source: "scorecard" };
  }
  if (!funnel && dealFlowPage) {
    const dial = await settle(async () => {
      const { loadDialFunnel } = await import("@/lib/dealFlow/dialFunnelLoader");
      return loadDialFunnel(tenantId, { fromDate: month.from, toDate: month.to, timeZone: zone }, scope);
    });
    const built = dial ? funnelSteps(dial.steps.map((step) => ({ key: step.key, label: step.label, count: step.count })), dealFlowPage) : null;
    if (built && (dial?.steps[0]?.count ?? 0) > 0) funnel = { title: "Lead to application", ...built, href: dealFlowPage, source: "dial" };
  }
  if (!funnel && chart && chart.totalIn > 0) {
    const calledOfMonth = monthData!.leads.filter((lead) => lead.first_dial_at).length;
    const built = funnelSteps([{ key: "in", label: "Leads in", count: chart.totalIn }, { key: "called", label: "Called", count: calledOfMonth }], workspace);
    if (built) funnel = { title: "Leads called", ...built, href: workspace, source: "leads" };
  }

  /* Vendors: the scorecard's vendor roll-up, else this month's leads by vendor (no reach without it) */
  let vendors: LeadsViewData["vendors"] = null;
  if (scorecard && scorecard.vendor_rows.length) {
    const lines: VendorLine[] = scorecard.vendor_rows.map((row) => ({ id: row.vendor_id, name: row.vendor_name, leads: row.leads_received, reachedPct: row.contact_rate_percent, costPerSaleCents: row.effective_cost_per_issued_policy_cents, testBatch: row.is_test_batch }));
    const table = vendorTable(lines, money, (id) => (vendorsPage ? `${vendorsPage}/vendors/${id}` : trueCpaHref));
    if (table.rows.length) vendors = { ...table, href: trueCpaHref, source: "scorecard" };
  }
  if (!vendors && sources && workspace) {
    // Without the scorecard there is no "reached" (a contact) per vendor; what this view truly counts is
    // whether each of this month's leads was dialled. Every row opens the lead workspace (no vendor filter).
    vendors = {
      heads: ["Source", "Leads", "Called"],
      rows: sources.slices.map((slice) => ({ key: slice.key, cells: [slice.label, slice.value.toLocaleString("en-US"), `${Math.round((slice.called / slice.value) * 100)}%`], href: slice.href ?? workspace })),
      href: workspace,
      source: "leads",
    };
  }

  /* Hero: lead spend for money roles; otherwise leads ready to dial; otherwise leads in */
  let hero: LeadsViewData["hero"] = null;
  if (money && scorecard && trueCpaHref) {
    const t = scorecard.totals;
    hero = { kind: "spend", spendCents: t.net_spend_cents, costPerSaleCents: t.effective_cost_per_issued_policy_cents, costPerLeadCents: t.effective_cost_per_lead_cents, issued: t.issued_policies, href: trueCpaHref };
  } else if (ready !== null && dialer) {
    hero = { kind: "ready", ready, href: dialer };
  } else if (chart) {
    hero = { kind: "in", leadsIn: chart.totalIn, called: chart.totalCalled, href: chart.href };
  }

  return {
    needs,
    chart,
    sources,
    funnel,
    vendors,
    hero,
    speed: speed && workspace ? { items: speedItems(speed, now, (id) => `${workspace}/${id}`), href: workspace } : null,
    period: { from: month.from, to: month.to },
  };
}
