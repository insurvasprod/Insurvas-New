"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { ClickRow } from "@/components/app/book/policy/click-row";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { EXPENSE_BUCKET_COPY, monthName, shiftMonth } from "@/lib/accounting/expensesCore";
import type { MonthScoreboard, ScoreboardItem } from "@/lib/accounting/expenseStore";
import { formatCentsAsCurrency } from "@/lib/money";

const money = (cents: number) => formatCentsAsCurrency(cents);

/**
 * The Scoreboard tab (owner 2026-11-06; round 7 board 3·1): the month's biggest items under the strip every tab
 * shares. ‹ Month › step in the toolbar. A row opens where the cost came from: a lead bill → Vendor bills, an
 * expense → All expenses searched for it.
 */
const fromHref = (i: ScoreboardItem) => (i.fromInvoice ? "/app/vendor-bills" : `/app/expenses?view=booked&q=${encodeURIComponent(i.what)}`);

export function ExpenseScoreboard({ board }: { board: MonthScoreboard }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const { month } = board;
  const here = (m: string) => `/app/expenses?view=scoreboard&month=${m}`;
  return (
    <TableCard
      toolbar={
        <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
          <Button variant="outline" size="icon" asChild><Link href={here(shiftMonth(month, -1))} aria-label={`${monthName(shiftMonth(month, -1))}`} title={monthName(shiftMonth(month, -1))}><ChevronLeft aria-hidden="true" /></Link></Button>
          <span className="min-w-36 text-center text-sm font-semibold tabular-nums">{monthName(month)}</span>
          <Button variant="outline" size="icon" asChild><Link href={here(shiftMonth(month, 1))} aria-label={`${monthName(shiftMonth(month, 1))}`} title={monthName(shiftMonth(month, 1))}><ChevronRight aria-hidden="true" /></Link></Button>
        </DataToolbar>
      }
      footer={<><span>Counted on the day each cost was for. Lead bills come from Vendor bills once approved.</span><span className="font-semibold tabular-nums text-foreground">{money(board.totalCents)}</span></>}
    >
      {board.items.length === 0 ? <EmptyState title={`Nothing spent in ${monthName(month).split(" ")[0]}`} hint="Approved vendor bills and the expenses you add or OK show up here." /> : (
        <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead><tr><th>What</th><th>Bucket</th><th>From</th><th className="text-right">Amount</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {board.items.map((i) => (
              <ClickRow key={`${i.bucket}-${i.what}`} href={fromHref(i)} label={`Open ${i.what}`}>
                <td className="whitespace-nowrap font-medium text-foreground">{i.what}</td>
                <td className="whitespace-nowrap">{EXPENSE_BUCKET_COPY[i.bucket].short}</td>
                <td className="whitespace-nowrap"><Link className="hover:underline" href={fromHref(i)}>{i.fromInvoice ? "Vendor bill" : "Expense"}</Link></td>
                <td className="whitespace-nowrap text-right tabular-nums">{money(i.amountCents)}</td>
              </ClickRow>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
