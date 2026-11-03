"use client";

import { useEffect, useMemo, useState, type ComponentType, type SVGProps } from "react";
import Link from "next/link";
import { ArrowLeftRight, ChevronRight, FileCheck, Gauge, HandCoins, KeyRound, Network, Route, UserRoundCheck, WalletCards } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/view-tabs";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { BarSeries, ShareBar } from "@/components/ui/chart";
import { HomePanel, PanelLink } from "@/components/app/home/home-panel";
import { HomeAttention } from "@/components/app/home/home-attention";
import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshButton } from "@/components/ui/data-toolbar";
import { ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { useMenuSections } from "@/components/ui/page-trail";
import { StepSlot } from "@/components/app/step-frame/step-slot";
import { dollars } from "@/lib/agency/constants";
import type { AttentionItem } from "@/lib/dashboard/homeView";
import { Money } from "./money";
import { useAgencyData } from "./use-agency-data";
import { moneySplit, periodChange, standing, type AgencyDashboardView, type AgencyProducerRow } from "@/lib/agency/dashboardCore";

/**
 * The shape lives in `lib/agency/dashboardCore.ts` so the sample data behind `/design/agency` has
 * something to be typed against. The store's richer `AgencyDashboard` is assignable to it.
 */
type Row = AgencyProducerRow;
type Dashboard = AgencyDashboardView;

/** Sample data in place of the API, for `/design/agency` (development only). */
export type AgencyPreview = { data: Dashboard | null; error?: string; previous?: Dashboard | null };

function monthRange(offset: number) {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), label: first.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
}

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Every agency page, one click from the dashboard (owner 2026-11-03: "everything inside an agency here"). Each is the
 * menu item of the same key, so a tile shows only when the server-filtered menu offers that page to this person —
 * a plan, a role or a hidden page takes the tile away with the link. Producers is first: it left the rail and lives
 * here as a shortcut.
 */
const TOOLS: { key: string; label: string; href: string; icon: Icon; sub: string }[] = [
  { key: "team.producers", label: "Producers", href: "/app/producers", icon: UserRoundCheck, sub: "Roster, onboarding, carriers" },
  { key: "team.hierarchy", label: "Hierarchy & overrides", href: "/app/hierarchy", icon: Network, sub: "Who reports to whom, levels" },
  { key: "team.payouts", label: "Producer payouts", href: "/app/producer-payouts", icon: WalletCards, sub: "Pay runs and statements" },
  { key: "team.splits", label: "Commission splits", href: "/app/commission-splits", icon: HandCoins, sub: "Shared policies, who gets what" },
  { key: "commissions.producer_reconciliation", label: "Producer pay", href: "/app/producer-reconciliation", icon: ArrowLeftRight, sub: "Expected, reported, received" },
  { key: "team.scorecards", label: "Producer scorecards", href: "/app/producer-scorecards", icon: Gauge, sub: "Who is profitable, not just busy" },
  { key: "team.review", label: "Application review", href: "/app/application-review", icon: FileCheck, sub: "Sampled applications to check" },
  { key: "team.routing", label: "Lead routing", href: "/app/lead-routing", icon: Route, sub: "Who gets which lead" },
];

/** What waits across the agency, read from the pages that own each queue; a read that is refused or fails is left out. */
type Waiting = { blocked?: number; levels?: number; payIssues?: number; toReview?: number; complaints?: number };

const getJson = async <T,>(url: string): Promise<T | null> => {
  const response = await fetch(url, { cache: "no-store" }).catch(() => null);
  return response?.ok ? ((await response.json().catch(() => null)) as T | null) : null;
};

/**
 * AG-0.11 · the agency's dashboard (redesign 2026-11-03, /ui-taste critique in docs/agency/DASHBOARD.md): the agency
 * at a glance, not the person's own day (that is Home). Top to bottom:
 *
 *   Needs you      every agency queue with something in it, as Home draws it — one row of links
 *   the strip      five figures, each the door into its page: issued, override, owed, at risk, producers
 *   Agency tools   a tile per agency page this person may open (Producers first)
 *   the charts     who wrote it, and where the money went
 *   Producers      the period's standing; a name opens the producer's record; "All producers" the roster
 *   Expiring       licences and appointments inside 60 days, only when there are any
 *
 * Under the sample a count ("6/9"), never a percentage. Every money figure says its basis. A manager sees his
 * reports and no agency money.
 */
export function AgencyDashboard({ agencyName, scoped, preview, slot, canManage = false }: { agencyName: string; scoped: boolean; preview?: AgencyPreview; slot?: string; canManage?: boolean }) {
  const [which, setWhich] = useState<"this" | "last">("this");
  const range = useMemo(() => monthRange(which === "this" ? 0 : -1), [which]);
  const live = useAgencyData<Dashboard>(preview ? null : `/api/app/agency/dashboard?from=${range.from}&to=${range.to}`);
  const { data, error, loading, refreshing, reload } = preview
    ? { data: preview.data, error: preview.error ?? "", loading: false, refreshing: false, reload: () => {} }
    : live;
  // The comparison is a second read of the same endpoint for the month before. It starts as null
  // — `useAgencyData` skips a null url — and is given its url once the current period has
  // painted, so the strip is never waiting on it. A failed comparison is silent: no pills, no
  // banner, the page still works.
  const previousRange = useMemo(() => monthRange(which === "this" ? -1 : -2), [which]);
  const [wantPrevious, setWantPrevious] = useState(false);
  useEffect(() => {
    if (preview) return;
    const after = window.setTimeout(() => setWantPrevious(true), 0);
    return () => { window.clearTimeout(after); setWantPrevious(false); };
  }, [preview, previousRange.from]);
  const previous = useAgencyData<Dashboard>(
    preview || !wantPrevious ? null : `/api/app/agency/dashboard?from=${previousRange.from}&to=${previousRange.to}`,
  );
  const before = preview ? preview.previous ?? null : previous.data;

  // The tiles this person may open: the shell's menu, already filtered by plan, role and hidden pages. The design
  // sample has no shell, so it shows them all.
  const menu = useMenuSections();
  const offered = useMemo(() => (menu ? new Set(menu.flatMap((section) => section.items.map((entry) => entry.key))) : null), [menu]);
  const tools = TOOLS.filter((tool) => !offered || offered.has(tool.key));
  const toolKeys = tools.map((tool) => tool.key).join(",");

  const [waiting, setWaiting] = useState<Waiting>({});
  useEffect(() => {
    if (preview) return;
    let active = true;
    const has = (key: string) => toolKeys.split(",").includes(key);
    void Promise.all([
      has("team.producers") ? getJson<{ counts?: { producers?: number } }>("/api/app/agency/steps") : null,
      !scoped ? getJson<{ counts?: { discrepancies?: number; hierarchy?: number } }>("/api/app/commissions/steps") : null,
      has("team.review") ? getJson<{ reviews?: Array<{ status: string }>; canReview?: boolean }>("/api/app/agency/review") : null,
      !scoped ? getJson<{ counts?: { complaints?: number } }>("/api/app/compliance/steps") : null,
    ]).then(([agency, commissions, review, compliance]) => {
      if (!active) return;
      setWaiting({
        blocked: agency?.counts?.producers,
        levels: commissions?.counts?.hierarchy,
        payIssues: commissions?.counts?.discrepancies,
        toReview: review?.canReview ? review.reviews?.filter((row) => row.status === "queued").length : undefined,
        complaints: compliance?.counts?.complaints,
      });
    });
    return () => { active = false; };
  }, [preview, scoped, toolKeys]);

  const [producerPage, setProducerPage] = useState(1);
  const [alertPage, setAlertPage] = useState(1);
  const pageSize = useFittingPageSize(480, 45);
  // The page's question, answered by the first column: ranked by what was issued, which is the
  // production the agency is paid on. Ties share a rank and the order is stable (dashboardCore).
  const ranked = standing(data?.producers ?? [], (row) => row.issued);
  const rankOf = new Map(ranked.map((row) => [row.id, row.rank]));
  const ordered = ranked
    .map((row) => (data?.producers ?? []).find((p) => p.producerUserId === row.id))
    .filter((row): row is Row => Boolean(row));
  const producers = paginate(ordered, producerPage, pageSize);
  const alerts = paginate(data?.alerts ?? [], alertPage, pageSize);
  const mostAtRisk = data?.producers.reduce<Row | null>((top, r) => (r.advanceAtRiskCents > (top?.advanceAtRiskCents ?? 0) ? r : top), null) ?? null;

  /** The period's totals, from the rows the page already has — no second query for any of these. */
  const totals = (rows: Row[] | undefined) => ({
    issued: (rows ?? []).reduce((sum, r) => sum + r.issued, 0),
    submitted: (rows ?? []).reduce((sum, r) => sum + r.submitted, 0),
    advance: (rows ?? []).reduce((sum, r) => sum + r.advanceAtRiskCents, 0),
    chargeback: (rows ?? []).reduce((sum, r) => sum + r.chargebackCents, 0),
    spend: (rows ?? []).reduce((sum, r) => sum + r.leadSpendCents, 0),
  });
  const written = totals(data?.producers);
  const wasWritten = before ? totals(before.producers) : null;
  const atRisk = { total: written.advance + written.chargeback, chargeback: written.chargeback };
  const issuedChange = periodChange(written.issued, wasWritten?.issued);
  const overrideChange = periodChange(data?.overrideCents ?? null, before?.overrideCents);
  const atRiskChange = periodChange(atRisk.total, wasWritten ? wasWritten.advance + wasWritten.chargeback : undefined);
  const standingBars = ranked
    .filter((row) => row.value > 0)
    .slice(0, 12)
    .map((row) => ({ key: row.id, label: row.name.split(" ")[0], value: row.value }));
  const split = moneySplit({ overrideCents: data?.overrideCents ?? null, payableOutCents: data?.payableOutCents ?? null, leadSpendCents: written.spend })
    ?.map((part, index) => ({ key: part.label, label: part.label, value: part.value, tone: (["strong", "mid", "faint"] as const)[index] }));
  /**
   * A brand-new agency, not a quiet month. The difference matters: an agency with producers who
   * wrote nothing in November wants its charts, because "nobody wrote anything" is the finding.
   * An agency with no producers at all wants to be told what this page will become.
   */
  const isNew = (data?.producers.length ?? 0) === 0;
  const seats = data?.seats.max ? `${data.seats.used} of ${data.seats.max} seats` : data ? `${data.seats.used} seats used` : "";

  // Needs you, the agency's: each count links to the rows behind it, the most urgent first (HomeAttention sorts).
  const soonest = data?.alerts[0]?.daysLeft;
  const waitingItems: Array<AttentionItem | null> = [
    waiting.blocked ? { key: "blocked", count: waiting.blocked, label: waiting.blocked === 1 ? "producer can't submit" : "producers can't submit", tone: "danger" as const, href: "/app/producers?status=blocked" } : null,
    data?.alerts.length ? { key: "expiring", count: data.alerts.length, label: data.alerts.length === 1 ? "licence or appointment expiring" : "licences and appointments expiring", detail: soonest !== undefined ? `first in ${soonest} day${soonest === 1 ? "" : "s"}` : undefined, tone: soonest !== undefined && soonest <= 14 ? ("danger" as const) : ("warning" as const), href: "#expiring" } : null,
    waiting.complaints ? { key: "complaints", count: waiting.complaints, label: waiting.complaints === 1 ? "open complaint" : "open complaints", tone: "danger" as const, href: "/app/complaints" } : null,
    waiting.levels ? { key: "levels", count: waiting.levels, label: waiting.levels === 1 ? "contract level to fix" : "contract levels to fix", tone: "warning" as const, href: "/app/hierarchy?issues=1" } : null,
    !scoped && data?.negativeCount ? { key: "owing", count: data.negativeCount, label: data.negativeCount === 1 ? "producer owes the agency" : "producers owe the agency", tone: "warning" as const, href: "/app/producer-payouts" } : null,
    waiting.payIssues ? { key: "payIssues", count: waiting.payIssues, label: waiting.payIssues === 1 ? "pay issue" : "pay issues", tone: "info" as const, href: "/app/discrepancies" } : null,
    waiting.toReview ? { key: "review", count: waiting.toReview, label: waiting.toReview === 1 ? "application to review" : "applications to review", tone: "info" as const, href: "/app/application-review" } : null,
  ];
  const attention = waitingItems.filter((item): item is AttentionItem => item !== null);

  const headerActions = <>
    <Segmented label="Period" value={which} onChange={setWhich} options={[{ key: "this", label: "This month" }, { key: "last", label: "Last month" }]} />
    {!scoped && <Button asChild><Link href="/app/producers/invite">Invite producer</Link></Button>}
  </>;

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      {slot ? (
        // On /app/agency the server page draws the title and the facts; the period and the invite sit on its line.
        <StepSlot id={slot}>{headerActions}</StepSlot>
      ) : (
        <PageHeader
          title="Agency dashboard"
          description={scoped ? "Your reports: what they wrote, what it is worth, and what is at risk." : "Which of your producers is actually making the agency money."}
          meta={<p className="mt-1 text-sm leading-normal text-muted-foreground">{agencyName} · {range.label}</p>}
          actions={headerActions}
        />
      )}
      {error ? <ErrorState detail={error} action={<Button variant="outline" onClick={reload}>Try again</Button>} /> : loading || !data ? <SectionLoading rows={4} columns={6} label="Loading the dashboard" /> : (
        <>
          {isNew ? (
            // One line, not a card (§3): a new agency's page should read as new rather than broken,
            // and the strip's honest zeros underneath are the rest of the answer.
            <p role="status" className="m-0 text-sm leading-normal text-muted-foreground">
              {scoped
                ? "Nothing here yet. As the producers who report to you submit, their production, persistency and advance risk appear on this page."
                : "Nothing here yet. Invite a producer and this page fills in from their first application — what they wrote, what it is worth, and what is at risk."}
            </p>
          ) : <HomeAttention items={attention} />}

          {/* Five figures that answer the page's question — am I making money, and from whom. Each tile is the link
              to the rows behind it (§6: a figure is a door). One ink for all of them: the change pill, the sign and
              the line beneath carry what the figure is doing. */}
          <StatStrip label="Agency at a glance">
            <StatTile
              label="Issued"
              value={written.issued.toLocaleString("en-US")}
              delta={issuedChange === null ? undefined : { value: issuedChange, goodWhen: "up" }}
              footnote={<>Submitted · <span className="font-semibold text-foreground">{written.submitted.toLocaleString("en-US")}</span></>}
              href={offered && !offered.has("team.scorecards") ? undefined : "/app/producer-scorecards"}
            />
            {!scoped && <StatTile
              label="Override"
              labelTitle="What carriers paid the agency on producers' business this period, less the producers' reported share."
              value={data.overrideCents === null ? "—" : dollars(data.overrideCents)}
              delta={overrideChange === null ? undefined : { value: overrideChange, goodWhen: "up" }}
              footnote="What the agency keeps"
              href={offered && !offered.has("team.hierarchy") ? undefined : "/app/hierarchy"}
            />}
            {!scoped && <StatTile
              label="Owed to producers"
              labelTitle="Producers' positive balances on the reported basis: what the next pay run would pay out."
              value={data.payableOutCents === null ? "—" : dollars(data.payableOutCents)}
              footnote={data.ledgerReady ? (data.negativeCount ? <>Owe you back · <span className="font-semibold text-foreground">{data.negativeCount}</span></> : "Nobody owes you back") : "Once the payable ledger is live"}
              href={offered && !offered.has("team.payouts") ? undefined : "/app/producer-payouts"}
            />}
            <StatTile
              label="At risk"
              labelTitle="Unearned advance that could come back, plus what has already been clawed back this period."
              value={dollars(atRisk.total)}
              delta={atRiskChange === null ? undefined : { value: atRiskChange, goodWhen: "down" }}
              footnote={<>Clawed back · <span className="font-semibold text-foreground">{dollars(atRisk.chargeback)}</span></>}
              href={offered && !offered.has("retention.lapse-risk") ? undefined : "/app/lapse-risk"}
            />
            <StatTile
              label={scoped ? "Your reports" : "Producers"}
              value={data.producers.length.toLocaleString("en-US")}
              footnote={waiting.blocked ? <>Can&apos;t submit · <span className="font-semibold text-[var(--error-ink)]">{waiting.blocked}</span></> : scoped ? "Can submit" : seats}
              href={offered && !offered.has("team.producers") ? undefined : "/app/producers"}
            />
          </StatStrip>

          {/* Agency tools: the shortcuts. Producers is no longer a rail beside the dashboard; it is the first tile. */}
          {(tools.length > 0 || canManage) && (
            <section aria-label="Agency tools" className="@container">
              <h2 className="sr-only">Agency tools</h2>
              {/* Rows that fill: nine tiles are three by three, eight four by two — never one tile alone on a row. */}
              <ul className={`m-0 grid list-none grid-cols-1 gap-3 p-0 @md:grid-cols-2 ${(tools.length + (canManage ? 1 : 0)) % 3 === 0 ? "@4xl:grid-cols-3" : "@4xl:grid-cols-4"}`}>
                {tools.map((tool) => (
                  <li key={tool.key}>
                    <ToolTile href={tool.href} icon={tool.icon} label={tool.label} sub={toolFact(tool.key, waiting, data, seats) ?? tool.sub} />
                  </li>
                ))}
                {canManage && (
                  <li>
                    <ToolTile href="/app/settings#team-access" icon={KeyRound} label="Team & access" sub="Logins, roles and seats" />
                  </li>
                )}
              </ul>
            </section>
          )}

          {/* One 12-column row: the standing beside where the money went. Container queries, not
              viewport breakpoints — the sidebar takes its share of the width (§4b). */}
          {!isNew && <div className="@container">
            <div className="grid gap-4 @4xl:grid-cols-12">
              <HomePanel title="Who wrote it" period={range.label} className="@4xl:col-span-7" link={offered && !offered.has("team.scorecards") ? undefined : { label: "Scorecards", href: "/app/producer-scorecards" }}>
                {standingBars.length ? (
                  <BarSeries
                    bars={standingBars}
                    summary={`Policies issued per producer in ${range.label}: ${standingBars.map((bar) => `${bar.label} ${bar.value}`).join(", ")}`}
                    unit="issued"
                    barMaxWidth={56}
                    labels="all"
                    minHeight={148}
                  />
                ) : (
                  <p className="m-0 py-6 text-center text-sm text-muted-foreground">Nothing issued in {range.label}.</p>
                )}
              </HomePanel>
              <HomePanel title="Where the money went" period={range.label} className="@4xl:col-span-5" link={scoped ? undefined : { label: "Ledger", href: "/app/ledger" }}>
                {split ? (
                  <ShareBar
                    segments={split}
                    summary={`${range.label}: ${split.map((part) => `${part.label} ${dollars(part.value)}`).join(", ")}`}
                    format={dollars}
                  />
                ) : (
                  <p className="m-0 py-6 text-center text-sm text-muted-foreground">No money moved in {range.label}.</p>
                )}
                {!data.ledgerReady && (
                  <p className="m-0 mt-2 text-xs text-muted-foreground">What you owe producers appears here once the payable ledger is live.</p>
                )}
              </HomePanel>
            </div>
          </div>}

          {/* The period's standing. A name opens the producer's record; the roster is one link away. */}
          {data.producers.length > 0 && (
            <TableCard
              title="Producer standing"
              info="Every producer who can submit, ranked by what was issued this period. Placement and month-4 / month-13 survival show a count until there are enough policies for a percentage. Balance is on the reported basis."
              action={<span className="flex items-center gap-1">
                <RefreshButton onClick={reload} refreshing={refreshing} />
                {(!offered || offered.has("team.producers")) && <PanelLink href="/app/producers">All producers</PanelLink>}
              </span>}
              footer={<Pager page={producers.current} total={data.producers.length} noun="producers" pageSize={pageSize} onPage={setProducerPage} />}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-right">#</TableHead>
                    <TableHead>Producer</TableHead>
                    <TableHead className="text-right">Submitted</TableHead>
                    <TableHead className="text-right">Issued</TableHead>
                    <TableHead className="text-right">Placement</TableHead>
                    <TableHead className="text-right" title="Still paying at month 4 and month 13">Month 4 · 13</TableHead>
                    <TableHead className="text-right">Advance at risk</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {producers.rows.map((r) => (
                    <TableRow key={r.producerUserId}>
                      {/* Quiet and tabular, not a medal: the rank orders the eye, it does not decorate the row. */}
                      <TableCell className="text-right tabular-nums text-muted-foreground">{rankOf.get(r.producerUserId)}</TableCell>
                      <TableCell className="font-medium">
                        {r.producerId && (!offered || offered.has("team.producers"))
                          ? <Link className="hover:underline" href={`/app/producers/${r.producerId}`} title={`Open ${r.name}'s record`}>{r.name}</Link>
                          : r.name}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.submitted}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.issued}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.placement}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.m4.text} · {r.m13.text}</TableCell>
                      {/* The worst advance risk is marked on the figure, not by washing the whole row: this is a
                          thing to watch, not a thing that is wrong. */}
                      <TableCell className="text-right">
                        <Money
                          cents={r.advanceAtRiskCents}
                          className={mostAtRisk?.producerUserId === r.producerUserId && r.advanceAtRiskCents > 0 ? "font-semibold text-[var(--warning-ink)]" : undefined}
                        />
                      </TableCell>
                      <TableCell className="text-right">{data.ledgerReady ? <Money cents={r.balanceCents} /> : <span className="text-[var(--muted)]">—</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          )}

          {/* Only when something expires: Needs you already says "nothing" by leaving the chip out. */}
          {data.alerts.length > 0 && (
            <div id="expiring" className="scroll-mt-4">
              <TableCard title="Expiring inside 60 days" info="Licences and appointments. An expiry stops that producer from submitting." footer={<Pager page={alerts.current} total={data.alerts.length} noun="expiries" pageSize={pageSize} onPage={setAlertPage} />}>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Producer</TableHead><TableHead>Item</TableHead><TableHead>Detail</TableHead><TableHead className="text-right">Expires</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts.rows.map((a, i) => {
                      const record = data.producers.find((p) => p.producerUserId === a.producerUserId)?.producerId;
                      return (
                        <TableRow key={`${a.producerUserId}-${a.item}-${i}`}>
                          <TableCell className="font-medium">{record && (!offered || offered.has("team.producers")) ? <Link className="hover:underline" href={`/app/producers/${record}?tab=${a.item === "Licence" ? "onboarding" : "carriers"}`}>{a.name}</Link> : a.name}</TableCell>
                          <TableCell>{a.item}</TableCell>
                          <TableCell>{a.detail}</TableCell>
                          <TableCell className="text-right"><StatusChip tone={a.daysLeft <= 14 ? "danger" : "warning"}>in {a.daysLeft} day{a.daysLeft === 1 ? "" : "s"}</StatusChip></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableCard>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A tile's live line, where the dashboard already knows something better than the tile's description. */
function toolFact(key: string, waiting: Waiting, data: Dashboard | null, seats: string): string | null {
  if (key === "team.producers" && data) return [`${data.producers.length} producer${data.producers.length === 1 ? "" : "s"}`, seats].filter(Boolean).join(" · ");
  if (key === "team.hierarchy" && waiting.levels) return `${waiting.levels} level${waiting.levels === 1 ? "" : "s"} to fix`;
  if (key === "team.payouts" && data?.payableOutCents) return `${dollars(data.payableOutCents)} owed`;
  if (key === "team.review" && waiting.toReview) return `${waiting.toReview} to review`;
  return null;
}

/** One shortcut: the page's icon, its name and one live line, the whole tile the link (the mockup card). */
function ToolTile({ href, icon: Glyph, label, sub }: { href: string; icon: Icon; label: string; sub: string }) {
  return (
    <Link
      href={href}
      className="m-glass group flex h-full min-w-0 items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-inherit no-underline transition-colors hover:border-[var(--border-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--surface-alt)] text-[var(--accent-ink)]">
        <Glyph className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}
