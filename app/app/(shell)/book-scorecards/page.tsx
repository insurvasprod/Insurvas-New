import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { addMonths } from "@/lib/ledger/compute";
import {
  BUCKETS, DIMENSIONS, centsText, chargebacks, drillParam, drillRows, everyWeek, historyStart, netByWeek, persistencyAll, placement, readDrill, scorecards, slices,
  type PersistencyCell, type ScorePolicy,
} from "@/lib/ingestion/scorecards";
import { loadScorecards, loadWeekEntries, SCORECARDS_PENDING_MESSAGE } from "@/lib/ingestion/scorecardsStore";
import { BookScorecards, ScoreDrill, type CellView, type ScorecardsView } from "@/components/app/book-scorecards";
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
 * Owner, producer (their own book) and bookkeeper, as Persistency. Opening the page writes nothing.
 */
// Foundation pass (2026-11-03, docs/reports/FOUNDATION-PASS.md): Overview's five stacked cards are tabs of
// their own; an old ?view=overview opens Book.
const VIEWS = ["book", "persistency", "chargebacks", "weeks", "scorecards", "today"] as const;
const INFO = "Persistency, placement, chargebacks and net commission, computed live from your carrier files and the ledger. Every figure opens the rows behind it. Under the agency's sample size a share shows as a count; a bucket the book's history can't fill yet reads Building. Placed means issued and paid at least once.";
const PLACEMENT_SETS = [{ set: "placed", label: "Placed" }, { set: "issued", label: "Issued" }, { set: "not_placed", label: "Never paid" }] as const;
const PERIODS = [3, 6, 12, 24] as const;

const cellView = (c: PersistencyCell): CellView => ({ month: c.month, building: c.building, readyOn: c.readyOn, eligible: c.eligible, alive: c.alive, premiumEligibleCents: c.premiumEligibleCents, premiumAliveCents: c.premiumAliveCents, premiumUnknown: c.premiumUnknown, endUnknown: c.endUnknown });

export default async function BookScorecardsPage({ searchParams }: { searchParams: Promise<{ view?: string; months?: string; drill?: string }> }) {
  const guard = await guardPage("cohort_persistency");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Book scorecards" description="Persistency, placement, chargebacks and net commission from your carrier files, by carrier, product, agent and lead source." />;
  }
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Book scorecards" detail="Scorecards are read by the account owner, producers (their own book) and bookkeepers." />;
  }

  const sp = await searchParams;
  const view = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as (typeof VIEWS)[number]) : "book";
  const months = (PERIODS as readonly number[]).includes(Number(sp.months)) ? Number(sp.months) : 12;
  const drill = readDrill(sp.drill);
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role };
  // Inside the Reports page, which draws the title and trail (a drill names its figure there).

  const todayUtc = new Date().toISOString().slice(0, 10);
  const firstRead = await loadScorecards(viewer, { from: addMonths(todayUtc, -months), to: todayUtc }, { withClients: Boolean(drill), withSpend: view === "scorecards" && !drill });
  if (!firstRead.available) {
    return <ReportsPage view="book" info={INFO}><div className="m-stagger flex flex-col gap-6"><TableCard><EmptyState title="No carrier files read yet" hint="Scorecards appear once a policy file from a carrier has been read." /></TableCard></div></ReportsPage>;
  }
  const data = firstRead;
  const period = { from: addMonths(data.today, -months), to: data.today };
  const start = historyStart(data.policies);
  const ctx = { today: data.today, start, from: period.from, to: period.to, minSample: data.minSample };
  const back = `/app/book-scorecards?view=${view}&months=${months}`;

  if (drill) {
    if (drill.kind === "week") {
      const entries = await loadWeekEntries(viewer, drill.week);
      return (
        <ReportsPage view="book" title={`Commission lines in the week of ${drill.week}`} facts={entries ? `${entries.length} ${entries.length === 1 ? "line" : "lines"} · ${centsText(entries.reduce((sum, e) => sum + e.cents, 0))} in all` : SCORECARDS_PENDING_MESSAGE}>
          <div className="m-stagger flex flex-col gap-6">
            <ScoreDrill entries={entries ?? []} />
          </div>
        </ReportsPage>
      );
    }
    const set = drillRows(data.policies, drill, ctx);
    const pl = placement(data.policies, data.submissions, period.from, period.to);
    const throughInsurvas = pl.submitted === null ? "nothing submitted through Insurvas in the period" : `through Insurvas: ${pl.submitted} submitted, ${pl.submittedIssued ?? 0} issued so far`;
    const byKey = new Map<string, ScorePolicy>(data.policies.map((p) => [p.key, p]));
    return (
      <ReportsPage view="book" title={set?.title ?? "Nothing behind this figure"} facts={[set?.figure ?? "The figure has no rows yet.", drill.kind === "placement" ? throughInsurvas : null].filter(Boolean).join(" · ")}>
      <div className="m-stagger flex flex-col gap-6">
        <ScoreDrill
          // A placement figure has sibling sets: they are the record's tabs, on the title line.
          tabs={drill.kind === "placement" ? { active: drill.set, items: PLACEMENT_SETS.map((p) => ({ key: p.set, label: p.label, href: `${back}&drill=${encodeURIComponent(drillParam({ kind: "placement", set: p.set }))}` })) } : undefined}
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
    for (const p of data.policies) {
      const key = dim === "carrier" ? p.carrierId : dim === "product" ? p.productKey : dim === "agent" ? p.agentKey : dim === "agency" ? p.agencyKey : p.sourceKey;
      const name = dim === "carrier" ? p.carrierName : dim === "product" ? p.productName : dim === "agent" ? p.agentName : dim === "agency" ? p.agencyName : p.sourceName;
      const group = keys.get(key) ?? { name, members: [] };
      group.members.push(p);
      keys.set(key, group);
    }
    return [...keys.entries()].map(([key, g]) => ({ key, name: g.name, policies: g.members.length, cells: persistencyAll(g.members, data.today, start).map(cellView) })).sort((a, b) => b.policies - a.policies || a.name.localeCompare(b.name));
  };

  const model: ScorecardsView = {
    view,
    months,
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
    policies: data.policies.length,
    overall: persistencyAll(data.policies, data.today, start).map(cellView),
    book: Object.fromEntries((["carrier", "product", "status", "agent", "agency"] as const).map((dim) => [dim, strip(slices(data.policies, dim))])) as ScorecardsView["book"],
    whole: strip(slices(data.policies, "all"))[0] ?? null,
    placement: (() => { const p = placement(data.policies, data.submissions, period.from, period.to); return { issued: p.issued.length, placed: p.placed.length, notPlaced: p.notPlaced.length, submitted: p.submitted, submittedIssued: p.submittedIssued }; })(),
    chargebacks: Object.fromEntries((["all", ...DIMENSIONS] as const).map((dim) => [dim, chargebacks(data.policies, dim).map(({ members: _m, earlierMembers: _e, ...rest }) => rest)])) as ScorecardsView["chargebacks"],
    weeks: data.weeks ? everyWeek(netByWeek(data.weeks), data.today) : null,
    persistencyBy: Object.fromEntries(DIMENSIONS.map((dim) => [dim, groupsFor(dim)])) as ScorecardsView["persistencyBy"],
    cards: Object.fromEntries(DIMENSIONS.map((dim) => [dim, scorecards(data.policies, dim, { ...ctx, spend }).map(({ members: _m, salesMembers: _s, contract, ...rest }) => ({ ...rest, contract: cellView(contract) }))])) as ScorecardsView["cards"],
    spendAvailable: Boolean(data.spend),
    buckets: [...BUCKETS],
  };

  return (
    <ReportsPage view="book" info={INFO}>
      <div className="m-stagger flex flex-col gap-6">
        <BookScorecards model={model} framed />
      </div>
    </ReportsPage>
  );
}
