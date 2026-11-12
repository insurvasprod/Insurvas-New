import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { addMonths } from "@/lib/ledger/compute";
import {
  BUCKETS, CONTRACT_MONTH, DIMENSIONS, DIMENSION_LABELS, FILTER_KEYS, ISSUE_PERIOD, centsText, chargebacks, dailyEvents, drillParam, drillRows, everyWeek, filterPolicies, historyStart, inForceSeries, monthSteps, netByWeek,
  persistencyAll, persistencySeries, placedSeries, placement, readDrill, readFilter, scorecards, scorecardsHref, slices,
  type PersistencyCell, type ScorePolicy, type ScorecardsQuery,
} from "@/lib/ingestion/scorecards";
import { statusLabel } from "@/lib/ingestion/policyBook";
import { loadScorecards, loadWeekEntries, SCORECARDS_PENDING_MESSAGE } from "@/lib/ingestion/scorecardsStore";
import { showOf } from "@/lib/reports/show";
import { BookScorecards, ScoreDrill, type CellView, type DrillNarrow, type ScorecardsView } from "@/components/app/book-scorecards";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ReportsPage } from "@/components/app/reports/reports-page";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Insight › Book scorecards (LA-4.18, Notion sprint): persistency at 3, 6, 9 and 13 months by count
 * and by premium, the book by slice, placement, chargeback ratio, net commission by week, the
 * scorecards by carrier, product, agent, agency and lead source, and today's summary. All of it is
 * computed live from the carrier files and the ledger, and every figure opens the rows behind it.
 *
 * Reports round 7 (owner pick 4·A, "leave it", 2026-11-11): a Table · Chart switch on the title line
 * (`?show=`, the chart first); Group by and Measured by are selects; the cards stay, each with a small line
 * of its own figure over the period. Owner 2026-11-12 ("put this in every sub page inside the reports"):
 * Today and every drill have the switch too, opening on the table, where the work is done.
 *
 * Owner, producer (their own book) and bookkeeper, as Persistency. Opening the page writes nothing.
 */
// Foundation pass (2026-11-03, docs/reports/FOUNDATION-PASS.md): Overview's five stacked cards are tabs of
// their own; an old ?view=overview opens Book.
const VIEWS = ["book", "persistency", "chargebacks", "weeks", "scorecards", "today"] as const;
const INFO = "Persistency, placement, chargebacks and net commission, computed live from your carrier files and the ledger. Every figure opens the rows behind it. Under the agency's sample size a share shows as a count; a bucket the book's history can't fill yet reads Building. Placed means issued and paid at least once.";
const PLACEMENT_SETS = [{ set: "placed", label: "Placed" }, { set: "issued", label: "Issued" }, { set: "not_placed", label: "Never paid" }] as const;
const PERIODS = [3, 6, 12, 24] as const;
/** Each tab's Group by choices, the first its default (4·1). */
const GROUP_BY: Record<(typeof VIEWS)[number], readonly string[]> = {
  book: ["carrier", "product", "status", "agent", "agency"],
  persistency: ["carrier", "product", "agent", "agency", "source"],
  chargebacks: ["carrier", "product", "agent", "source"],
  weeks: [],
  scorecards: ["source", "carrier", "product", "agent", "agency"],
  today: [],
};

const cellView = (c: PersistencyCell): CellView => ({ month: c.month, building: c.building, readyOn: c.readyOn, eligible: c.eligible, alive: c.alive, premiumEligibleCents: c.premiumEligibleCents, premiumAliveCents: c.premiumAliveCents, premiumUnknown: c.premiumUnknown, endUnknown: c.endUnknown });

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function BookScorecardsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const guard = await guardPage("cohort_persistency");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Book scorecards" description="Persistency, placement, chargebacks and net commission from your carrier files, by carrier, product, agent and lead source." />;
  }
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Book scorecards" detail="Scorecards are read by the account owner, producers (their own book) and bookkeepers." />;
  }

  const sp = await searchParams;
  const view = (VIEWS as readonly string[]).includes(one(sp.view) ?? "") ? (one(sp.view) as (typeof VIEWS)[number]) : "book";
  const months = (PERIODS as readonly number[]).includes(Number(one(sp.months))) ? Number(one(sp.months)) : 12;
  const drill = readDrill(one(sp.drill));
  const by = GROUP_BY[view].includes(one(sp.by) ?? "") ? (one(sp.by) as string) : GROUP_BY[view][0] ?? null;
  const measure = one(sp.measure) === "premium" ? "premium" : "count";
  const filter = readFilter(sp);
  // Today is work and a drill is rows: both open on the table (owner 2026-11-12); the report tabs on the chart.
  const show = showOf(sp, view === "today" || drill ? "table" : "chart");
  const query: ScorecardsQuery = { view, months, by, measure, show, filter };
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role };
  // Inside the Reports page, which draws the title and trail (a drill names its figure there).

  const todayUtc = new Date().toISOString().slice(0, 10);
  const firstRead = await loadScorecards(viewer, { from: addMonths(todayUtc, -months), to: todayUtc }, { withClients: Boolean(drill), withSpend: view === "scorecards" && !drill });
  if (!firstRead.available) {
    return <ReportsPage view="book" info={INFO}><div className="m-stagger flex flex-col gap-6"><TableCard><EmptyState title="No carrier files read yet" hint="Scorecards appear once a policy file from a carrier has been read." /></TableCard></div></ReportsPage>;
  }
  const data = firstRead;
  const period = { from: addMonths(data.today, -months), to: data.today };
  // Each carrier's history starts where its whole file allows (scorecards-persistency-history-rule): read
  // from the whole book before any filter narrows it.
  const start = historyStart(data.policies);
  const policies = filterPolicies(data.policies, filter);
  const ctx = { today: data.today, start, from: period.from, to: period.to, minSample: data.minSample };
  // A drill keeps the filters, so its rows are the figure's own; it opens on its table (drillAt below).

  if (drill) {
    // The drill's own narrowing (its chart's bars): an issue period on a policy drill, a day or a kind on the
    // week's lines. With the filters, they stay in every link the drill draws.
    const issuedIn = ISSUE_PERIOD.test(one(sp.issued) ?? "") ? (one(sp.issued) as string) : null;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.day) ?? "") ? (one(sp.day) as string) : null;
    const kind = one(sp.kind) || null;
    const narrowing = drill.kind === "week" ? { day, kind } : { issued: issuedIn };
    const drillAt = (d: typeof drill, withShow: boolean) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(narrowing)) if (value) params.set(key, value);
      const extra = params.toString();
      return `${scorecardsHref({ ...query, show: withShow ? query.show : null })}&drill=${encodeURIComponent(drillParam(d))}${extra ? `&${extra}` : ""}`;
    };
    const here = drillAt(drill, false);
    // The filters' names, from the whole book (as the Filters panel names them), for the drill's chips.
    const filterName = (key: (typeof FILTER_KEYS)[number], value: string) => {
      const p = data.policies.find((x) => (key === "carrier" ? x.carrierId : key === "product" ? x.productKey : key === "agent" ? x.agentKey : key === "agency" ? x.agencyKey : key === "source" ? x.sourceKey : x.status ?? "unknown") === value);
      if (!p) return value;
      return key === "carrier" ? p.carrierName : key === "product" ? p.productName : key === "agent" ? p.agentName : key === "agency" ? p.agencyName : key === "source" ? p.sourceName : statusLabel(p.status);
    };
    const FILTER_NAMES = { carrier: "Carrier", product: "Product", status: "Status", agent: "Agent", agency: "Agency", source: "Lead source" } as const;
    const narrowed: DrillNarrow[] = [
      ...(drill.kind === "week" ? [] : FILTER_KEYS.filter((key) => filter[key]).map((key) => ({ key, label: FILTER_NAMES[key], value: filterName(key, filter[key] as string) }))),
      ...(issuedIn && drill.kind !== "week" ? [{ key: "issued", label: "Issued", value: issuedIn, kind: "period" as const }] : []),
      ...(day ? [{ key: "day", label: "Day", value: day, kind: "day" as const }] : []),
      ...(kind ? [{ key: "kind", label: "Kind", value: kind.replaceAll("_", " ") }] : []),
    ];

    if (drill.kind === "week") {
      const all = await loadWeekEntries(viewer, drill.week);
      const entries = all ? all.filter((e) => (!day || e.countedOn.slice(0, 10) === day) && (!kind || e.type === kind)) : null;
      return (
        <ReportsPage view="book" title={`Commission lines in the week of ${drill.week}`} facts={entries ? `${entries.length} ${entries.length === 1 ? "line" : "lines"} · ${centsText(entries.reduce((sum, e) => sum + e.cents, 0))} in all` : SCORECARDS_PENDING_MESSAGE} show="table">
          <div className="m-stagger flex flex-col gap-6">
            <ScoreDrill entries={entries ?? []} show={show} here={here} week={drill.week} narrowed={narrowed} />
          </div>
        </ReportsPage>
      );
    }
    const found = drillRows(policies, drill, ctx);
    const issueOf = new Map(policies.map((p) => [p.key, p.issueDate]));
    const set = found && issuedIn ? { ...found, rows: found.rows.filter((r) => (issueOf.get(r.key) ?? "").startsWith(issuedIn)) } : found;
    const pl = placement(policies, data.submissions, period.from, period.to);
    const throughInsurvas = pl.submitted === null ? "nothing submitted through Insurvas in the period" : `through Insurvas: ${pl.submitted} submitted, ${pl.submittedIssued ?? 0} issued so far`;
    const byKey = new Map<string, ScorePolicy>(policies.map((p) => [p.key, p]));
    const setSize = (s: (typeof PLACEMENT_SETS)[number]["set"]) => (s === "placed" ? pl.placed.length : s === "issued" ? pl.issued.length : pl.notPlaced.length);
    // A placement set says what it is a part of (4·5: "738 of 1,580 issued in the last 12 months").
    const figure = drill.kind === "placement"
      ? drill.set === "issued" ? `${pl.issued.length.toLocaleString("en-US")} issued in the last ${months} months` : `${setSize(drill.set).toLocaleString("en-US")} of ${pl.issued.length.toLocaleString("en-US")} issued in the last ${months} months`
      : set?.figure ?? "The figure has no rows yet.";
    return (
      <ReportsPage view="book" title={set?.title ?? "Nothing behind this figure"} facts={[figure, drill.kind === "placement" ? throughInsurvas : null].filter(Boolean).join(" · ")} show="table">
      <div className="m-stagger flex flex-col gap-6">
        <ScoreDrill
          // A placement figure has sibling sets: they are the record's tabs, on the title line.
          tabs={drill.kind === "placement" ? { active: drill.set, items: PLACEMENT_SETS.map((p) => ({ key: p.set, label: p.label, count: setSize(p.set), href: drillAt({ kind: "placement", set: p.set }, true) })) } : undefined}
          show={show}
          here={here}
          narrowed={narrowed}
          policies={(set?.rows ?? []).map((r) => {
            const p = byKey.get(r.key) as ScorePolicy;
            return { key: r.key, note: r.note, tone: r.tone, clientName: p.clientName, carrierId: p.carrierId, carrierName: p.carrierName, policyNumber: p.policyNumber, status: p.status, issueDate: p.issueDate, annualCents: p.annualCents, agentName: p.agentName, sourceName: p.sourceName };
          })}
        />
      </div>
      </ReportsPage>
    );
  }

  const spend = data.spend ? new Map(data.spend) : undefined;
  const strip = <T extends { members: unknown }>(rows: T[]) => rows.map(({ members: _members, ...rest }) => rest);
  const groupsFor = (dim: (typeof DIMENSIONS)[number]) => {
    const keys = new Map<string, { name: string; members: ScorePolicy[] }>();
    for (const p of policies) {
      const key = dim === "carrier" ? p.carrierId : dim === "product" ? p.productKey : dim === "agent" ? p.agentKey : dim === "agency" ? p.agencyKey : p.sourceKey;
      const name = dim === "carrier" ? p.carrierName : dim === "product" ? p.productName : dim === "agent" ? p.agentName : dim === "agency" ? p.agencyName : p.sourceName;
      const group = keys.get(key) ?? { name, members: [] };
      group.members.push(p);
      keys.set(key, group);
    }
    return [...keys.entries()].map(([key, g]) => ({ key, name: g.name, policies: g.members.length, cells: persistencyAll(g.members, data.today, start).map(cellView) })).sort((a, b) => b.policies - a.policies || a.name.localeCompare(b.name));
  };

  // The cards' small lines (0·C): one point a month over the period, from the same functions as the figures.
  const steps = monthSteps(data.today, Math.max(months, 6));
  const series: ScorecardsView["series"] = {
    inForce: inForceSeries(policies, steps).map((cents) => Math.round(cents / 100)),
    placed: placedSeries(policies, steps),
    // The tab's own strip is only drawn on Persistency; elsewhere only month 9 is needed.
    buckets: Object.fromEntries(BUCKETS.map((month) => [month, view === "persistency" || month === CONTRACT_MONTH ? persistencySeries(policies, month, steps, start) : []])) as ScorecardsView["series"]["buckets"],
  };

  // The Filters panel's choices, from the whole book so a filter can be changed, not only narrowed.
  const options = Object.fromEntries(FILTER_KEYS.map((key) => {
    const seen = new Map<string, string>();
    for (const p of data.policies) {
      const value = key === "carrier" ? p.carrierId : key === "product" ? p.productKey : key === "agent" ? p.agentKey : key === "agency" ? p.agencyKey : key === "source" ? p.sourceKey : p.status ?? "unknown";
      if (!seen.has(value)) seen.set(value, key === "carrier" ? p.carrierName : key === "product" ? p.productName : key === "agent" ? p.agentName : key === "agency" ? p.agencyName : key === "source" ? p.sourceName : statusLabel(p.status));
    }
    return [key, [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))];
  })) as ScorecardsView["filterOptions"];

  const model: ScorecardsView = {
    view,
    months,
    query,
    groupBy: GROUP_BY[view].map((key) => ({ key, label: DIMENSION_LABELS[key as keyof typeof DIMENSION_LABELS] })),
    filterOptions: options,
    periods: [...PERIODS],
    today: data.today,
    period,
    // How each carrier's persistency is counted, in words (scorecards.ts historyStart).
    history: (() => {
      const names = new Map(data.policies.map((p) => [p.carrierId, p.carrierName]));
      const fromFirstFile = [...start.byCarrier.keys()].filter((id) => !start.fromIssue.has(id)).map((id) => ({ name: names.get(id) ?? "Unknown carrier", since: start.byCarrier.get(id) as string })).sort((a, b) => a.name.localeCompare(b.name));
      return { fromIssue: start.fromIssue.size, fromFirstFile };
    })(),
    minSample: data.minSample,
    canEditSettings: guard.role === "owner" && data.settingsAvailable && guard.entitlement.access !== "read_only",
    scoped: data.scoped,
    summary: data.summary,
    policies: policies.length,
    overall: persistencyAll(policies, data.today, start).map(cellView),
    book: Object.fromEntries((["carrier", "product", "status", "agent", "agency"] as const).map((dim) => [dim, strip(slices(policies, dim))])) as ScorecardsView["book"],
    whole: strip(slices(policies, "all"))[0] ?? null,
    placement: (() => { const p = placement(policies, data.submissions, period.from, period.to); return { issued: p.issued.length, placed: p.placed.length, notPlaced: p.notPlaced.length, submitted: p.submitted, submittedIssued: p.submittedIssued }; })(),
    chargebacks: Object.fromEntries((["all", ...DIMENSIONS] as const).map((dim) => [dim, chargebacks(policies, dim).map(({ members: _m, earlierMembers: _e, ...rest }) => rest)])) as ScorecardsView["chargebacks"],
    weeks: data.weeks ? everyWeek(netByWeek(data.weeks), data.today) : null,
    persistencyBy: Object.fromEntries(DIMENSIONS.map((dim) => [dim, view === "persistency" ? groupsFor(dim) : []])) as ScorecardsView["persistencyBy"],
    cards: Object.fromEntries(DIMENSIONS.map((dim) => [dim, scorecards(policies, dim, { ...ctx, spend }).map(({ members: _m, salesMembers: _s, contract, ...rest }) => ({ ...rest, contract: cellView(contract) }))])) as ScorecardsView["cards"],
    spendAvailable: Boolean(data.spend),
    buckets: [...BUCKETS],
    series,
    // Today's line: issued and lapsed a day over the last 14 days, dated on the policies themselves.
    daily: view === "today" ? dailyEvents(policies, data.today) : null,
  };

  return (
    <ReportsPage view="book" info={INFO} show={view === "today" ? "table" : "chart"}>
      <div className="m-stagger flex flex-col gap-6">
        <BookScorecards model={model} framed />
      </div>
    </ReportsPage>
  );
}
