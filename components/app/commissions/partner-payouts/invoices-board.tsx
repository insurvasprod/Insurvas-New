"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataToolbar, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Segmented } from "@/components/ui/view-tabs";
import { invoiceRef } from "@/lib/accounting/partnerPayoutCore";
import { formatCentsAsCurrency } from "@/lib/money";
import { usDate, usDay } from "@/components/app/commissions/team-payouts/shared";
import { listOrder, stateOf, type InvoiceState, type InvoiceTab } from "./invoice-state";

/**
 * Commissions › Partner payouts, the three invoice tabs (round 7, owner pick 9·A, 2026-11-10). One list per tab; a row
 * opens its invoice; one chip says where it stands, and "Next step" is one short verb, never a button. The partner's
 * name opens the partner (Partners › terms). One line per row, one text colour (owner 2026-11-11).
 */
export type InvoiceRow = { id: string; partnerId: string; partnerName: string; periodStart: string; periodEnd: string; status: string; netCents: number; paidOn: string | null; invoiceNumber?: string | null };

const money = (c: number) => formatCentsAsCurrency(c);
const PERIODS = [{ key: "90", label: "Last 90 days" }, { key: "365", label: "Last 12 months" }, { key: "all", label: "All time" }] as const;
const since = (days: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
const period = (r: InvoiceRow) => (r.periodStart.slice(0, 4) === r.periodEnd.slice(0, 4) ? `${usDay(r.periodStart)} – ${usDate(r.periodEnd)}` : `${usDate(r.periodStart)} – ${usDate(r.periodEnd)}`);

/** Where the invoice stands: the row's one chip. */
const STATE: Record<InvoiceState, { tone: StatusTone; label: string }> = {
  review: { tone: "warning", label: "To review" },
  pay: { tone: "warning", label: "To pay" },
  paid: { tone: "good", label: "Paid" },
  nothing: { tone: "neutral", label: "Nothing owed" },
  void: { tone: "neutral", label: "Void" },
};
/** The next step: one short verb; the whole row opens the invoice. */
const NEXT: Record<InvoiceState, string> = { review: "Review ›", pay: "Pay ›", paid: "Open ›", nothing: "Open ›", void: "Open ›" };
const FOOT: Record<InvoiceTab, string> = { review: "Drafts: the partner can't see these until you publish", pay: "Published: the partner sees these in their portal; nothing is paid from here", paid: "Paid, nothing owed and void invoices stay on record" };
const SUM: Record<InvoiceTab, string> = { review: "waiting for your review", pay: "to pay", paid: "paid" };

export function InvoicesBoard({ tab, runs, recordLinks }: {
  tab: InvoiceTab;
  runs: InvoiceRow[];
  /**
   * Items on each invoice, and the partner's rulebook as words. Not drawn since the one-line rows (owner 2026-11-11,
   * six columns at most): the invoice page shows its items, the partner record its rulebook. Still passed by the page.
   */
  items: Record<string, number>;
  models: Record<string, string>;
  recordLinks: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<(typeof PERIODS)[number]["key"]>("365");
  const [chip, setChip] = useState<"all" | InvoiceState>("all");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(300, 52);
  const from = range === "all" ? "" : since(Number(range));
  const inRange = useMemo(() => listOrder(runs).filter((r) => !from || r.periodEnd >= from), [runs, from]);
  const needle = search.trim().toLowerCase();
  const visible = inRange
    .filter((r) => chip === "all" || stateOf(r) === chip)
    .filter((r) => !needle || r.partnerName.toLowerCase().includes(needle) || invoiceRef(r).toLowerCase().includes(needle));
  const shown = paginate(visible, page, pageSize);
  const count = (s: InvoiceState) => inRange.filter((r) => stateOf(r) === s).length;
  const total = visible.filter((r) => stateOf(r) !== "void").reduce((sum, r) => sum + r.netCents, 0);
  const open = (r: InvoiceRow) => `/app/payouts/${r.id}?from=${tab}`;

  return (
    <TableCard
      toolbar={runs.length === 0 ? undefined : (
        <DataToolbar actions={<>
          <select aria-label="Period" className={toolbarControl} value={range} onChange={(e) => { setRange(e.target.value as typeof range); setPage(1); }}>{PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
          <span className="text-sm"><span className="font-semibold tabular-nums">{money(total)}</span> {SUM[tab]}</span>
        </>}>
          <ToolbarSearch value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search partner or invoice" />
          {tab === "paid" ? <Segmented label="Paid invoices" value={chip} onChange={(k) => { setChip(k); setPage(1); }} options={[
            { key: "all", label: "All", count: inRange.length },
            { key: "paid", label: "Paid", count: count("paid") || null },
            { key: "nothing", label: "Nothing owed", count: count("nothing") || null },
            { key: "void", label: "Void", count: count("void") || null },
          ]} /> : null}
        </DataToolbar>
      )}
      footer={runs.length === 0 ? undefined : (
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{FOOT[tab]}</p>
          {visible.length > pageSize ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="invoices" onPage={setPage} /> : null}
        </div>
      )}
    >
      {runs.length === 0 ? (
        <EmptyState title={tab === "review" ? "Nothing to review" : tab === "pay" ? "Nothing to pay" : "No paid invoices yet"} hint={tab === "review" ? "Run payouts makes a draft invoice for every partner whose pay period has ended, priced from their rulebook." : tab === "pay" ? "A published invoice that owes the partner waits here until you mark it paid." : "An invoice you mark paid stays here, with the day it was paid."} />
      ) : visible.length === 0 ? <NoMatches noun="invoices" onClear={() => { setSearch(""); setRange("all"); setChip("all"); }} /> : (
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-[22%]">Partner</TableHead><TableHead className="w-[16%]">Invoice</TableHead><TableHead className="w-[20%]">Pay period</TableHead>
            <TableHead className="w-[13%] text-right">Net payable</TableHead><TableHead>Status</TableHead><TableHead className="w-[12%]">Next step</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {shown.rows.map((r) => {
              const state = stateOf(r);
              // A run that nets below zero says so in its chip; the amount keeps its minus sign, never a colour.
              const owesYou = r.netCents < 0 && state !== "void";
              const label = state === "paid" && r.paidOn ? `Paid ${usDate(r.paidOn)}` : owesYou ? "Owes you · next invoice" : STATE[state].label;
              return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(open(r))}>
                  <TableCell className="whitespace-nowrap font-medium">
                    {recordLinks ? <Link href={`/app/publishers/${r.partnerId}?tab=terms`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{r.partnerName}</Link> : r.partnerName}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{invoiceRef(r)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{period(r)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{money(r.netCents)}</TableCell>
                  <TableCell><StatusChip tone={owesYou ? "warning" : STATE[state].tone}>{label}</StatusChip></TableCell>
                  <TableCell className="whitespace-nowrap">{NEXT[state]}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}
