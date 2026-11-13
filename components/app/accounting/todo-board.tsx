"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { dayMonth } from "@/lib/format/dates";
import { formatCentsAsCurrency } from "@/lib/money";
import { atStakeCents, orderTodo, type TodoItem } from "@/lib/accounting/todoCore";

type Show = "all" | "yours" | "money";

/**
 * Accounting › To do (round 7, mockups-r7/accounting.html 0·1): one row per thing that waits on a person,
 * oldest first. A row opens the page or dialog where it is done; the row itself decides nothing. The group
 * (Bank, Bills…) is the title line's sub-page bar; this list holds that group's rows.
 */
export function TodoBoard({ items, groupLabel }: { items: TodoItem[]; groupLabel: string | null }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [order, setOrder] = useState<"oldest" | "largest">("oldest");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(520, 56);
  const [refreshing, startRefresh] = useTransition();
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const rows = items
      .filter((i) => show === "all" || (show === "yours" ? i.yours : i.tone === "bad"))
      .filter((i) => !needle || `${i.what} ${i.detail} ${i.where}`.toLowerCase().includes(needle));
    return order === "oldest" ? orderTodo(rows) : [...rows].sort((a, b) => Math.abs(b.amountCents ?? 0) - Math.abs(a.amountCents ?? 0));
  }, [items, show, needle, order]);
  const paged = paginate(shown, page, pageSize);
  const pick = (s: Show) => { setShow(s); setPage(1); };
  const yours = items.filter((i) => i.yours).length;
  const money = items.filter((i) => i.tone === "bad").length;

  return (
    <TableCard
      toolbar={
        <DataToolbar actions={<>
          <select aria-label="Order" className={toolbarControl} value={order} onChange={(e) => setOrder(e.target.value === "largest" ? "largest" : "oldest")}>
            <option value="oldest">Oldest first</option>
            <option value="largest">Largest amount first</option>
          </select>
          <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
        </>}>
          <ToolbarSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search what's waiting" />
          <Segmented label="Show" value={show} onChange={pick} options={[
            { key: "all", label: "Everything", count: items.length },
            { key: "yours", label: "Mine to do", count: yours || null },
            { key: "money", label: "Money at stake", count: money || null, tone: "danger" },
          ]} />
        </DataToolbar>
      }
      footer={shown.length ? (
        <div className="flex w-full flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {shown.length > pageSize ? <Pager page={paged.current} total={shown.length} noun="things waiting" pageSize={pageSize} onPage={setPage} /> : null}
          <span className="ml-auto tabular-nums">{shown.length.toLocaleString("en-US")} {shown.length === 1 ? "thing" : "things"} waiting · {formatCentsAsCurrency(atStakeCents(shown))} at stake</span>
        </div>
      ) : undefined}
    >
      {items.length === 0 ? (
        <EmptyState
          title={groupLabel ? `Nothing waits in ${groupLabel}` : "Nothing waits for you"}
          hint="Deposits are matched, bills are paid and monthly bills are OK'd. New work shows here as it arrives."
          action={<Link className="text-sm font-medium text-[var(--accent-ink)] underline-offset-2 hover:underline" href="/app/pnl">Open Profit &amp; loss</Link>}
        />
      ) : shown.length === 0 ? (
        <NoMatches noun="things waiting" onClear={() => { setQ(""); pick("all"); }} />
      ) : (
        <table className="portal-lead-table w-full min-w-[920px] text-left text-sm">
          <thead><tr><th>What&apos;s waiting</th><th>Where</th><th className="text-right">Amount</th><th>Since</th><th>Status</th><th>Next step</th></tr></thead>
          <tbody>
            {paged.rows.map((i) => (
              // One line per row (owner 2026-11-11): the old second line is the name's tooltip; colour is the chip's alone.
              <tr key={i.key} className="cursor-pointer" onClick={() => router.push(i.href)}>
                <td className="whitespace-nowrap font-medium text-foreground" title={i.detail}>
                  <Link href={i.href} className="hover:underline" onClick={(e) => e.stopPropagation()}>{i.what}</Link>
                </td>
                <td className="whitespace-nowrap">{i.where}</td>
                <td className="whitespace-nowrap text-right tabular-nums" title={i.amountWord && i.amountCents != null ? `${formatCentsAsCurrency(Math.abs(i.amountCents))} ${i.amountWord}` : undefined}>
                  {i.amountCents == null ? <span className="text-muted-foreground">—</span> : formatCentsAsCurrency(Math.abs(i.amountCents))}
                </td>
                <td className="whitespace-nowrap tabular-nums text-muted-foreground">{i.sinceLabel ?? (i.since ? dayMonth(i.since) : "—")}</td>
                <td><StatusChip tone={i.chip.tone}>{i.chip.amount && i.amountCents != null ? `${formatCentsAsCurrency(Math.abs(i.amountCents))} ${i.chip.label}` : i.chip.label}</StatusChip></td>
                <td className="whitespace-nowrap" title={i.next}>{i.step} ›</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
