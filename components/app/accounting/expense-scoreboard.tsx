import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { EXPENSE_BUCKET_COPY, shiftMonth } from "@/lib/accounting/expensesCore";
import type { MonthScoreboard } from "@/lib/accounting/expenseStore";
import { formatCentsAsCurrency } from "@/lib/money";

const money = (cents: number) => formatCentsAsCurrency(cents);

/**
 * The end-of-month scoreboard (owner, 2026-11-06): what the month cost, in total and per bucket, then the
 * biggest items. Leads are the lead invoices from Vendor bills plus lead buys entered here. ‹ › step months.
 */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (month: string) => { const [y, m] = month.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };

export function ExpenseScoreboard({ board }: { board: MonthScoreboard }) {
  const { month } = board;
  const share = (cents: number) => (board.totalCents > 0 ? `${String(Math.trunc((cents * 1000 + board.totalCents * 5) / (board.totalCents * 10)))}% of the month` : "nothing yet");
  const here = (m: string) => `/app/expenses?view=scoreboard&month=${m}`;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" asChild><Link href={here(shiftMonth(month, -1))} aria-label="The month before" title="The month before"><ChevronLeft aria-hidden="true" /></Link></Button>
        <span className="min-w-36 text-center text-sm font-semibold tabular-nums">{monthName(month)}</span>
        <Button variant="outline" size="icon" asChild><Link href={here(shiftMonth(month, 1))} aria-label="The month after" title="The month after"><ChevronRight aria-hidden="true" /></Link></Button>
      </div>
      <StatStrip label={`Spent in ${monthName(month)}`}>
        <StatTile label="Total spent" value={money(board.totalCents)} footnote={monthName(month)} href={here(month)} />
        <StatTile label="Leads" value={money(board.byBucket.leads)} footnote={share(board.byBucket.leads)} href="/app/vendor-bills" />
        <StatTile label="Subscriptions" value={money(board.byBucket.subscriptions)} footnote={share(board.byBucket.subscriptions)} href="/app/expenses?view=recurring" />
        <StatTile label="Daily & random" value={money(board.byBucket.daily)} footnote={share(board.byBucket.daily)} href="/app/expenses?view=booked" />
      </StatStrip>
      <TableCard footer={<p className="text-xs text-muted-foreground">Counted on the day each cost was for. Lead invoices come from Vendor bills once approved; a voided bill nets out.</p>}>
        {board.items.length === 0 ? <EmptyState title={`Nothing spent in ${monthName(month)}`} hint="Approved vendor bills and the expenses you add or OK show up here." /> : (
          <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
            <thead><tr><th>What</th><th>Bucket</th><th>From</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {board.items.map((i) => (
                <tr key={`${i.bucket}-${i.what}`}>
                  <td className="font-medium">{i.what}</td>
                  <td>{EXPENSE_BUCKET_COPY[i.bucket].short}</td>
                  <td className="text-muted-foreground">{i.fromInvoice ? "Vendor bill" : "Expense"}</td>
                  <td className="text-right tabular-nums">{money(i.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}
