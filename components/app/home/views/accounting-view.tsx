import { DashBars, DashChart, DashHero, DashLayout, DashList, DashNeeds, DashRing, DashTable, type DashBar, type DashItem, type DashLine, type DashNeed, type DashRow } from "@/components/app/home/dash/dash-kit";
import { LineSeries } from "@/components/ui/chart";
import { DeltaChip } from "@/components/ui/stat";
import { loadAccountingView, pnlMonthHref, receivedShare, shortDate, wholeDollars, whereMoneyWent, type RecentKind } from "@/lib/dashboard/views/accounting";
import { formatCentsAsCurrency } from "@/lib/money";

import type { DashViewProps } from "./view-props";

/**
 * The dashboard's Accounting view (owner 2026-11-06): what waits on the bookkeeper, money in against money
 * out over six months, how much of what the carriers reported has reached the bank, where this month's money
 * went, who is owed or owes back, this month's profit, and the newest money movements. Every figure opens
 * the page it was read from (lib/dashboard/views/accounting.ts); a card whose read failed or whose page is
 * closed to the reader is left out.
 */
const MARK: Record<RecentKind, string> = { deposit: "D", bill: "B", partnerRun: "P", producerRun: "R" };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

type AccountingData = NonNullable<Awaited<ReturnType<typeof loadAccountingView>>>;

/** The view's Needs you, most urgent first; also read by the Overview. */
export function accountingNeeds(data: AccountingData): DashNeed[] {
  const { hrefs, needs } = data;
  const tiles: DashNeed[] = [];
  if (hrefs.discrepancies && needs.payIssues !== null) tiles.push({ key: "pay-issues", count: needs.payIssues, label: plural(needs.payIssues, "Pay issue open", "Pay issues open"), detail: data.payIssuesOwedCents ? `${wholeDollars(data.payIssuesOwedCents)} appears owed` : "carrier paid against owed", tone: "danger", href: hrefs.discrepancies });
  if (hrefs.bank && needs.bank !== null) tiles.push({ key: "bank", count: needs.bank, label: plural(needs.bank, "Deposit to match", "Deposits to match"), detail: "to a carrier payment", tone: "warning", href: hrefs.bank });
  if (hrefs.producerPayouts && needs.producerToPay !== null) tiles.push({ key: "producer-runs", count: needs.producerToPay, label: plural(needs.producerToPay, "Producer run to pay", "Producer runs to pay"), detail: "published, not marked paid", tone: "warning", href: `${hrefs.producerPayouts}?tab=runs` });
  if (hrefs.bills && needs.bills !== null) tiles.push({ key: "bills", count: needs.bills, label: plural(needs.bills, "Vendor bill to approve", "Vendor bills to approve"), detail: "draft, received or disputed", tone: "warning", href: `${hrefs.bills}?status=approve` });
  if (hrefs.expenses && needs.expenses !== null) tiles.push({ key: "expenses", count: needs.expenses, label: plural(needs.expenses, "Expense to confirm", "Expenses to confirm"), detail: "recurring, arrived this period", tone: "info", href: `${hrefs.expenses}?view=confirm` });
  if (hrefs.payouts && needs.partnerDrafts !== null) tiles.push({ key: "partner-runs", count: needs.partnerDrafts, label: plural(needs.partnerDrafts, "Partner payout to review", "Partner payouts to review"), detail: "draft runs, not published", tone: "info", href: `${hrefs.payouts}?status=draft` });
  return tiles;
}

/** One figure for the Overview's "Your modules": this month's profit. */
export function accountingHeadline(data: AccountingData): { figure: string; line: string } | null {
  if (!data.statement) return null;
  return { figure: formatCentsAsCurrency(data.statement.netProfitCents), line: `${data.statement.netProfitCents < 0 ? "loss" : "profit"} · ${data.month.label}` };
}

export async function AccountingView(props: DashViewProps) {
  const data = await loadAccountingView(props);
  if (!data) return <DashNeeds items={[]} />;
  const { hrefs, month, basis } = data;
  const pnlFor = (anchor: string) => (hrefs.pnl ? pnlMonthHref(hrefs.pnl, anchor, basis) : null);
  const thisMonthPnl = pnlFor(month.from);

  const tiles = accountingNeeds(data);

  /* Big: money in against money out, six months; each point opens that month's P&L. */
  const trend = data.trend;
  const current = trend?.[trend.length - 1] ?? null;
  const previous = trend && trend.length > 1 ? trend[trend.length - 2] : null;
  const change = current && previous && previous.inCents > 0 ? Math.trunc(((current.inCents - previous.inCents) * 100) / previous.inCents) : null;
  const big = trend && current && hrefs.pnl ? (
    <DashChart
      title="Money in and out"
      link={{ label: "Profit & loss", href: `${pnlMonthHref(hrefs.pnl, month.from, basis)}&view=trend` }}
      total={wholeDollars(current.inCents)}
      totalLine={`in · ${month.label}`}
      change={change !== null ? <DeltaChip value={change} title="Money in against last month" /> : undefined}
      legend={[{ label: "Money in", tone: "primary" }, { label: "Money out", tone: "info" }]}
    >
      <LineSeries
        points={trend.map((point) => ({ key: point.month, label: point.label, value: point.inCents }))}
        compare={{ points: trend.map((point) => ({ key: point.month, label: point.label, value: point.outCents })), label: "Money out" }}
        summary={`Money in and money out per month for the last ${trend.length} months, on the ${basis} basis.`}
        format={wholeDollars}
        labels="all"
        minHeight={200}
        hrefFor={(point) => pnlFor(point.key)}
      />
    </DashChart>
  ) : null;

  /* Side: what the carriers reported this month against what the bank confirms. */
  const reported = data.statement?.inCents ?? null;
  const share = reported !== null ? receivedShare(reported, data.receivedCents) : null;
  const ringLines: DashLine[] = [];
  if (reported !== null && data.receivedCents !== null && hrefs.bank) ringLines.push({ label: "Received of reported", value: `${wholeDollars(data.receivedCents)} of ${wholeDollars(reported)}`, href: hrefs.bank });
  if (data.payIssuesOwedCents !== null && hrefs.discrepancies) ringLines.push({ label: "Short (pay issues)", value: wholeDollars(data.payIssuesOwedCents), href: hrefs.discrepancies });
  if (data.depositsCents !== null && hrefs.bank) ringLines.push({ label: `Deposits in ${month.label.split(" ")[0]}`, value: wholeDollars(data.depositsCents), href: hrefs.bank });
  const side = share !== null && hrefs.bank ? (
    <DashRing
      title="Commission received"
      link={{ label: "Bank deposits", href: hrefs.bank }}
      value={Math.min(100, share)}
      center={`${share}%`}
      label={`${share}% of the commission carriers reported for ${month.label} is confirmed in the bank`}
      tone={share >= 90 ? "primary" : share >= 60 ? "warning" : "danger"}
      lines={ringLines}
    />
  ) : null;

  /* Left: where this month's money went, from the P&L's own statement. */
  const left = data.statement && thisMonthPnl ? (
    <DashBars
      title="Where the money went"
      period={month.label}
      link={{ label: "Statement", href: thisMonthPnl }}
      rows={whereMoneyWent(data.statement).map((bar): DashBar => ({ key: bar.key, label: bar.label, value: Math.abs(bar.cents), shown: wholeDollars(bar.cents), tone: bar.tone, href: thisMonthPnl }))}
    />
  ) : null;

  /* Right: producer balances, each opening that producer's splits. */
  const right = data.producers && hrefs.splits ? (
    <DashTable
      title="Producer balances"
      period="today"
      link={{ label: "Producer splits", href: hrefs.splits }}
      heads={["Producer", "Owed", "Owes back"]}
      rows={data.producers.rows.map((row): DashRow => ({ key: row.userId, cells: [row.name, row.owedCents ? wholeDollars(row.owedCents) : "—", row.owesBackCents ? wholeDollars(row.owesBackCents) : "—"], href: `${hrefs.splits}/${row.userId}` }))}
      empty="No producer is owed or owes back."
    />
  ) : null;

  /* Hero: this month's profit, with what is owed out. */
  const facts: Array<{ label: string; value: string }> = [];
  if (data.producers) facts.push({ label: "Owed to producers", value: wholeDollars(data.producers.owedCents) });
  if (data.billsToPayCents !== null) facts.push({ label: "Bills to pay", value: wholeDollars(data.billsToPayCents) });
  const hero = data.statement && thisMonthPnl ? (
    <DashHero
      kicker={data.statement.netProfitCents < 0 ? `Loss · ${month.label}` : `Profit · ${month.label}`}
      value={formatCentsAsCurrency(data.statement.netProfitCents)}
      line={`${basis === "cash" ? "Cash" : "Accrual"} basis · held commission not counted`}
      facts={facts}
      href={thisMonthPnl}
    />
  ) : null;

  /* List: the newest money movements. */
  const list = data.recent ? (
    <DashList
      title="Recent money"
      link={hrefs.bank ? { label: "Bank deposits", href: hrefs.bank } : undefined}
      items={data.recent.map((item): DashItem => ({ key: item.key, mark: MARK[item.kind], tone: item.tone, title: item.title, detail: item.detail, value: wholeDollars(item.cents), when: shortDate(item.on), href: item.href }))}
      empty="No deposits, bills or payouts yet."
    />
  ) : null;

  return <DashLayout needs={<DashNeeds items={tiles} />} big={big} side={side} left={left} right={right} hero={hero} list={list} />;
}
