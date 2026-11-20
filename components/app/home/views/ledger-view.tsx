import type { ReactNode } from "react";

import { DashChart, DashHero, DashList, DashNeedsBar, DashTable, type DashItem, type DashNeed, type DashTone } from "@/components/app/home/dash/dash-kit";
import { LineSeries } from "@/components/ui/chart";
import { carrierCard } from "./agency-cards";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { cn } from "@/lib/utils";
import { FIRST_STATEMENT_PATH } from "@/lib/dashboard/checklist";
import { monthLabel, monthRange, shortDay } from "@/lib/dashboard/views/book";
import { loadLedgerHome } from "@/lib/dashboard/views/ledgerHome";
import type { DashViewProps } from "./view-props";

/**
 * The Ledger plan's Home (owner 2026-11-19), on the agency dashboard's frame (agency-view.tsx): a figure strip, two
 * rows of cards, and a right column that ends level with them. Ledger has no CRM, so every card is the book and its
 * money: what the carriers paid, what they owe, what they took back, and the statements behind it. A card whose read
 * failed, or whose page this reader cannot open, is left out; an empty card says what to do to fill it.
 */
const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const n = (value: number) => value.toLocaleString("en-US");
const pct = (now: number, then: number) => (then > 0 ? Math.round(((now - then) / then) * 100) : null);
const STATUS: Record<string, { label: string; tone: DashTone }> = {
  review: { label: "To review", tone: "warning" },
  reviewed: { label: "Reviewed", tone: "good" },
  processing: { label: "Reading", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
};

export async function LedgerView({ props, setup }: { props: DashViewProps; setup: { left: number; href: string } | null }) {
  const data = await loadLedgerHome(props);
  const { links, book: bookData, byMonth, owed, statements, month, previous } = data;
  const book = bookData.book;
  const at = (points: ReadonlyArray<{ key: string; value: number }> | undefined, key: string) => (points?.find((point) => point.key === key)?.value ?? 0) * 100;
  // Statements arrive after the month they pay for: until this month has money, the strip and the commission card show
  // the last month that does, against the month before it (never "$0, down 100%" on the 1st).
  const thisHasMoney = byMonth ? at(byMonth.received, month) > 0 || at(byMonth.chargebacks, month) > 0 : true;
  const shown = thisHasMoney ? month : previous;
  const keys = byMonth?.received.map((point) => point.key) ?? [];
  const before = keys[keys.indexOf(shown) - 1] ?? previous;
  const name = monthLabel(shown).split(" ")[0];
  const beforeName = monthLabel(before).split(" ")[0];

  /* ── Needs you: setup, then what the files and statements left ─────────────────────────────────── */
  const needs: DashNeed[] = [
    ...(setup && setup.left > 0 ? [{ key: "setup", count: setup.left, label: "Setup steps left", detail: "Get set up", tone: "info" as DashTone, href: setup.href }] : []),
    ...(statements && statements.toReview > 0 && links.statements ? [{ key: "review", count: statements.toReview, label: "Statements to review", detail: "lines to confirm", tone: "warning" as DashTone, href: `${links.statements}?status=review` }] : []),
    ...(owed && owed.count > 0 && links.discrepancies ? [{ key: "owed", count: owed.count, label: "Pay issues", detail: `${dollars(owed.totalCents)} owed to you`, tone: "warning" as DashTone, href: links.discrepancies }] : []),
    ...bookData.needs.map((need) => ({ ...need, tone: need.tone as DashTone })),
  ];

  /* ── The strip ─────────────────────────────────────────────────────────────────────────────────── */
  const tiles: ReactNode[] = [];
  if (byMonth && links.ledger) {
    const now = at(byMonth.received, shown);
    const then = at(byMonth.received, before);
    const change = now > 0 ? pct(now, then) : null;
    tiles.push(<StatTile key="in" label="Commission received" value={dollars(now)} delta={change !== null ? { value: change } : undefined} footnote={`${name} · ${dollars(then)} in ${beforeName}`} href={links.ledger} />);
  }
  if (owed && links.discrepancies) {
    tiles.push(<StatTile key="owed" label="Owed to you" value={dollars(owed.totalCents)} valueTone={owed.totalCents > 0 ? "warning" : undefined} footnote={owed.count ? `${n(owed.count)} pay ${owed.count === 1 ? "issue" : "issues"}` : statements && statements.total === 0 ? "Import a statement to check" : "Every reviewed line agrees"} href={links.discrepancies} />);
  }
  if (byMonth && links.ledger) {
    const back = at(byMonth.chargebacks, shown);
    const backBefore = at(byMonth.chargebacks, before);
    const change = back > 0 ? pct(back, backBefore) : null;
    tiles.push(<StatTile key="back" label="Chargebacks" value={dollars(back)} valueTone={back > 0 ? "warning" : undefined} delta={change !== null ? { value: change, goodWhen: "down" } : undefined} footnote={back ? `Taken back in ${name}` : "Nothing taken back"} href={`${links.ledger}?type=chargeback`} />);
  }
  if (book && links.policies) {
    tiles.push(<StatTile key="inforce" label="Policies in force" value={n(book.totals.inForce)} footnote={`${dollars(book.totals.annualCents)} a year`} href="/app/policies?show=inforce" />);
  }
  if (statements && links.statements) {
    tiles.push(<StatTile key="statements" label="Statements" value={n(statements.total)} footnote={statements.toReview ? `${n(statements.toReview)} to review` : statements.total ? "All reviewed" : "Drop in your first"} href={statements.total ? links.statements : FIRST_STATEMENT_PATH} />);
  }
  const strip = tiles.length ? <StatStrip label={`Your book in ${name}`}>{tiles}</StatStrip> : null;

  /* ── Row 1: commission by month · premium by carrier ───────────────────────────────────────────── */
  const yearIn = byMonth ? byMonth.received.reduce((sum, point) => sum + point.value, 0) * 100 : 0;
  const chart = byMonth && links.ledger ? (
    <DashChart
      title="Commission by month"
      link={{ label: "Commission Ledger", href: links.ledger }}
      total={dollars(yearIn)}
      totalLine={`received · last ${byMonth.received.length} months`}
      legend={[{ label: "Received", tone: "primary" }, { label: "Charged back", tone: "info" }]}
    >
      <LineSeries
        points={byMonth.received}
        compare={{ points: byMonth.chargebacks, label: "Charged back" }}
        summary="Commission the carriers paid each month over the last year, with what they took back beside it."
        unit="dollars"
        minHeight={180}
        hrefFor={(point) => {
          const range = monthRange(point.key);
          return `${links.ledger}?from=${range.from}&to=${range.to}`;
        }}
      />
    </DashChart>
  ) : null;

  // The agency dashboard's own carrier card (no new donuts, owner 2026-11-11).
  const carriers = book && links.policies ? carrierCard({ shares: book.shares, totalCents: book.totals.annualCents, inForce: book.totals.inForce, money: true, policiesHref: links.policies }) : null;

  /* ── Row 2: where the book stands · statements ─────────────────────────────────────────────────── */
  const standing = book && links.policies ? (
    <DashTable
      title="Where the book stands"
      link={{ label: "Policies", href: "/app/policies" }}
      heads={["Status", "Policies", "Annual premium"]}
      rows={book.standing.map((row) => ({ key: row.key, cells: [row.label, n(row.count), dollars(row.annualCents)], href: row.href }))}
    />
  ) : null;
  const statementList = statements && links.statements ? (
    <DashList
      title="Carrier statements"
      period="latest"
      link={{ label: "Statements", href: links.statements }}
      items={statements.recent.map((row): DashItem => {
        const status = STATUS[row.status] ?? { label: row.status, tone: "neutral" as DashTone };
        return { key: row.id, mark: status.tone === "good" ? "✓" : status.tone === "danger" ? "!" : "◷", tone: status.tone, title: row.carrierName ?? row.filename, detail: `${status.label}${row.periodEnd ? ` · period to ${shortDay(row.periodEnd)}` : ""}`, when: shortDay(row.uploadedAt.slice(0, 10)), href: `${links.statements}/${row.id}` };
      })}
      empty="No statement yet. Import one to check every commission against your contract."
    />
  ) : null;

  /* ── Right column: the commission card · owed to you · recent changes ──────────────────────────── */
  const hero = byMonth && links.ledger ? (
    <DashHero
      kicker={`COMMISSION · ${name.toUpperCase()}`}
      value={dollars(at(byMonth.received, shown))}
      line={`in from carriers · ${monthLabel(shown)}`}
      facts={[{ label: "This year", value: dollars(yearIn) }, ...(owed ? [{ label: "Owed", value: dollars(owed.totalCents) }] : [])]}
      href={links.ledger}
    />
  ) : null;
  const KIND: Array<{ key: keyof NonNullable<typeof owed>["byKind"]; label: string }> = [
    { key: "never_paid", label: "Never paid" },
    { key: "short_paid", label: "Paid short" },
    { key: "mis_rated", label: "Wrong rate" },
    { key: "unexpected_chargeback", label: "Chargeback to dispute" },
    { key: "duplicate_chargeback", label: "Charged back twice" },
  ];
  const owedCard = owed && links.discrepancies ? (
    <DashTable
      title="Owed to you"
      link={{ label: "Discrepancies", href: links.discrepancies }}
      heads={["Why", "Items", "Owed"]}
      rows={KIND.filter((kind) => owed.byKind[kind.key]?.count).map((kind) => ({ key: kind.key, cells: [kind.label, n(owed.byKind[kind.key].count), dollars(owed.byKind[kind.key].cents)], href: `${links.discrepancies}?kind=${kind.key}` }))}
      empty={statements && statements.total === 0 ? "Import a carrier statement and Insurvas checks every line against your contract." : "Nothing owed: every line you reviewed matches your contract."}
    />
  ) : null;
  const MARK: Record<string, { mark: string; tone: DashTone }> = { issued: { mark: "✓", tone: "good" }, lapsed: { mark: "!", tone: "danger" }, status: { mark: "↻", tone: "info" }, draft: { mark: "◷", tone: "warning" } };
  const activity = bookData.changes && bookData.links.changes ? (
    <DashList
      title="Recent changes"
      period="from the carrier files"
      link={{ label: "All Changes", href: bookData.links.changes }}
      items={bookData.changes.map((change): DashItem => ({ key: change.key, mark: MARK[change.kind].mark, tone: MARK[change.kind].tone, title: change.title, detail: change.detail, when: change.when, href: change.href }))}
      empty="No policy has changed yet."
    />
  ) : null;

  /* ── The page ──────────────────────────────────────────────────────────────────────────────────── */
  const fill = "lg:[&>*]:h-full lg:[&>*]:min-h-0 lg:[&>*]:overflow-hidden";
  const row1 = [chart, carriers].filter(Boolean);
  const row2 = [standing, statementList].filter(Boolean);
  const rowCount = (row1.length ? 1 : 0) + (row2.length ? 1 : 0);
  return (
    <div className="m-dash-ov flex w-full min-w-0 flex-col gap-4 pb-4 lg:min-h-0 lg:flex-1 lg:pb-0">
      {needs.some((need) => need.count > 0) && <DashNeedsBar items={needs} />}
      {strip}
      <div className="grid min-w-0 grid-cols-1 items-stretch gap-4 lg:min-h-0 lg:flex-1 xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className={cn("grid min-w-0 grid-cols-1 gap-4 lg:min-h-0", rowCount === 2 ? "lg:grid-rows-[minmax(0,1.05fr)_minmax(0,1fr)]" : "lg:grid-rows-[minmax(0,1fr)]")}>
          {row1.length > 0 && <div className={cn("grid min-w-0 grid-cols-1 gap-4 lg:min-h-0", fill, row1.length === 2 && "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]")}>{chart}{carriers}</div>}
          {row2.length > 0 && <div className={cn("grid min-w-0 grid-cols-1 gap-4 lg:min-h-0", fill, row2.length === 2 && "lg:grid-cols-2")}>{standing}{statementList}</div>}
        </div>
        <div className="relative min-w-0">
          <div className="flex flex-col gap-4 xl:absolute xl:inset-0 xl:[&>*:last-child]:min-h-0 xl:[&>*:last-child]:flex-1 xl:[&>*:last-child]:overflow-hidden">{hero}{owedCard}{activity}</div>
        </div>
      </div>
    </div>
  );
}
