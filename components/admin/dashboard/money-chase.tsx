"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { EmptyState } from "@/components/ui/page-states";

/**
 * Money › Invoices to chase (admin round 1, board section 3): one line a row, one text colour, the state in
 * one chip; a row opens its record. Three lists behind one switch: overdue invoices (oldest due first),
 * invoices whose total does not match what the provider charged, and subscriptions that are past due. The
 * rows come from the server already shaped; this only switches between them.
 */

export type ChaseRow = {
  key: string;
  /** Invoice number, or the customer for a subscription. */
  name: string;
  customer: string;
  amount: string;
  /** "Oct 1", or "—". */
  date: string;
  chip: { label: string; tone: "warning" | "danger" | "info" };
  /** The record the row opens; null when the role cannot open it. */
  href: string | null;
};

export type ChaseList = { key: "overdue" | "mismatched" | "pastDue"; label: string; count: number; rows: ChaseRow[]; dateLabel: string; amountLabel: string; firstLabel: string; more: { href: string; label: string } | null };

const SHOWN = 8;

export function MoneyChase({ lists }: { lists: ChaseList[] }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<ChaseList["key"]>(lists.find((list) => list.count > 0)?.key ?? lists[0]?.key ?? "overdue");
  const list = lists.find((item) => item.key === chosen) ?? lists[0];
  if (!list) return null;
  const rest = list.count - Math.min(list.rows.length, SHOWN);

  return (
    <TableCard
      title="Invoices to chase"
      action={<Segmented label="Which list" value={chosen} onChange={setChosen} options={lists.map((item) => ({ key: item.key, label: item.label, count: item.count }))} />}
      footer={rest > 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          and {rest.toLocaleString("en-US")} more{list.more && <> · <Link href={list.more.href} className="text-foreground hover:underline">{list.more.label}</Link></>}
        </div>
      ) : undefined}
    >
      {list.rows.length === 0 ? (
        <EmptyState title="Nothing to chase" hint={list.key === "overdue" ? "No invoice is past its due date." : list.key === "mismatched" ? "Every invoice matches what the provider charged." : "No subscription is past due."} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{list.firstLabel}</TableHead>
              <TableHead>{list.key === "pastDue" ? "Plan" : "Customer"}</TableHead>
              <TableHead className="text-right">{list.amountLabel}</TableHead>
              <TableHead>{list.dateLabel}</TableHead>
              <TableHead>Status</TableHead>
              <TableHead><span className="sr-only">Open</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.rows.slice(0, SHOWN).map((row) => (
              <TableRow key={row.key} className={row.href ? "cursor-pointer" : undefined} onClick={row.href ? () => router.push(row.href!) : undefined}>
                <TableCell className="font-medium tabular-nums">
                  {row.href ? <Link href={row.href} onClick={(event) => event.stopPropagation()} className="hover:underline">{row.name}</Link> : row.name}
                </TableCell>
                <TableCell className="max-w-[16rem] truncate">{row.customer}</TableCell>
                <TableCell className="text-right tabular-nums">{row.amount}</TableCell>
                <TableCell className="tabular-nums">{row.date}</TableCell>
                <TableCell><StatusChip tone={row.chip.tone}>{row.chip.label}</StatusChip></TableCell>
                <TableCell className="text-right text-muted-foreground" aria-hidden="true">{row.href ? "›" : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}
