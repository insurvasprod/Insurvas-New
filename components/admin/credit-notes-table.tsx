"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { notify } from "@/lib/notify";

import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { StatusChip } from "@/components/admin/status-chip";
import { fullDate } from "@/components/admin/tenant-record/billing-format";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { TableCard } from "@/components/ui/table-card";
import { DoneStamp } from "@/components/ui/done-stamp";
import { afterStamp } from "@/components/ui/use-done-stamps";
import { useDepartures } from "@/components/ui/use-row-exit";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { formatCentsAsCurrency } from "@/lib/money";
import { CREDIT_REASON_LABELS, type CreditReason } from "@/lib/credits/rules";
import { CREDIT_NOTE_LENSES, CREDIT_NOTE_LENS_LABELS, CREDIT_NOTE_RECONCILIATION, CREDIT_NOTE_STATUS_LABEL, CREDIT_NOTE_TONE, inCreditNoteLens, lensCounts, matchesCreditNoteSearch, parseCreditNoteLens, type CreditNoteLens } from "@/lib/invoices/creditNotesView";
import { cn } from "@/lib/utils";

export type CreditNoteRow = {
  id: string;
  number: string;
  type: "refund" | "credit" | "waiver";
  amount_cents: number;
  status: string;
  reason_code: CreditReason;
  reason_text: string | null;
  requested_by: string | null;
  created_at: string;
  reconciliation_state?: string;
  last_reconciliation_error?: string | null;
  tenants: { name: string } | null;
  invoice: { id: string; number: string } | null;
};


const th = "px-3 py-2 text-left text-xs leading-[1.33] font-semibold text-[var(--muted)]";
const td = "border-t border-[var(--border)] px-3 py-2 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]";

/**
 * Approve (never the raiser) or Retry reconciliation, on the row that needs it and in the credit note's sheet.
 * Shown rather than hidden for the raiser: the person waiting needs to know WHY they cannot act.
 *
 * Approved, "Approved" stamps in where the button was (Wave D, 2026-11-18) and the page refreshes once it has played;
 * on the Needs approval lens the row then plays out (useDepartures in the table).
 */
export function CreditNoteAction({ note, currentAdminId, size = "sm" }: { note: Pick<CreditNoteRow, "id" | "number" | "status" | "requested_by" | "reconciliation_state">; currentAdminId: string; size?: "sm" | "default" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [stamped, setStamped] = useState(false);
  const isOwn = note.requested_by === currentAdminId;
  const pending = note.status === "pending_approval";
  const providerPending = note.reconciliation_state === "provider_pending";

  async function act(action: "approve" | "reconcile") {
    setBusy(true);
    const res = await fetch(`/api/admin/credit-notes/${note.id}/${action}`, { method: "POST" });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      notify.block(body?.error ?? (action === "approve" ? "Could not approve" : "Could not reconcile"));
      return;
    }
    notify.done(body?.message ?? `${note.number} ${action === "approve" ? "approved" : "reconciled"}`);
    if (action === "approve") {
      setStamped(true);
      afterStamp(() => router.refresh());
      return;
    }
    router.refresh();
  }

  if (stamped) return <DoneStamp label="Approved" />;

  if (providerPending) return <Button type="button" variant="outline" size={size} disabled={busy} onClick={(event) => { event.stopPropagation(); void act("reconcile"); }}>Retry reconciliation</Button>;
  if (!pending) return null;
  if (isOwn) return <span className="text-xs text-[var(--muted)]">You raised this — a second admin must approve</span>;
  return <Button type="button" size={size} disabled={busy} onClick={(event) => { event.stopPropagation(); void act("approve"); }}>Approve</Button>;
}

/**
 * The refunds & credits table (p-adm-credit-notes, billing-r2 screen 6): every credit note, what it was raised
 * against, why, where the money stands and where our ledger stands. Lenses (All · Needs approval · Failed ·
 * Awaiting reconciliation) and the search are in the address (`lens=`, `q=`); a row opens its sheet with the
 * approval trail (`note=<id>`). Approve and Retry stay on the row that needs them.
 */
export function CreditNotesTable({ notes, currentAdminId }: { notes: CreditNoteRow[]; currentAdminId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [page, setPage] = useState(1);
  const lens = parseCreditNoteLens(params.get("lens"));
  const q = params.get("q") ?? "";
  const openId = params.get("note");
  const counts = useMemo(() => lensCounts(notes.filter((note) => matchesCreditNoteSearch(note, q))), [notes, q]);
  const rows = useMemo(() => notes.filter((note) => inCreditNoteLens(note, lens) && matchesCreditNoteSearch(note, q)), [notes, lens, q]);
  const pageSize = useFittingPageSize(420, 45);
  // A note approved here (or anywhere) leaves a lens it no longer belongs to; a lens or search change is another list.
  const left = useDepartures(rows, (note) => note.id, `${lens}|${q}`);
  const { current, rows: shown } = paginate(left.rows, page, pageSize);
  const anyFilter = lens !== "all" || Boolean(q.trim());

  const change = (patch: { lens?: CreditNoteLens; q?: string }) => {
    setPage(1);
    setParamsInPlace({ ...(patch.lens !== undefined ? { lens: patch.lens === "all" ? null : patch.lens } : {}), ...(patch.q !== undefined ? { q: patch.q || null } : {}) });
  };
  const sheetHref = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("note", id);
    return `/admin/credit-notes?${next.toString()}`;
  };

  return (
    <TableCard
      className="min-w-0"
      footer={rows.length > 0 ? <Pager page={current} pageSize={pageSize} total={rows.length} noun={rows.length === 1 ? "credit note" : "credit notes"} suffix="newest first" onPage={setPage} /> : undefined}
      toolbar={
        <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
          <div role="radiogroup" aria-label="Show" className="flex flex-wrap items-center gap-2">
            {CREDIT_NOTE_LENSES.map((key) => (
              <ToggleChip key={key} role="radio" selected={lens === key} count={counts[key]} onClick={() => change({ lens: key })}>{CREDIT_NOTE_LENS_LABELS[key]}</ToggleChip>
            ))}
          </div>
          <ToolbarSearch value={q} onChange={(value) => change({ q: value })} placeholder="Search credit note, customer or invoice" />
          {anyFilter && <Button type="button" variant="ghost" onClick={() => change({ lens: "all", q: "" })}>Clear</Button>}
        </DataToolbar>
      }
    >
      <table className="w-full min-w-[1040px] border-collapse">
        <thead>
          <tr className="bg-[var(--surface-alt)]">
            <th scope="col" className={cn(th, "w-[150px]")}>Credit note</th>
            <th scope="col" className={th}>Customer</th>
            <th scope="col" className={cn(th, "w-[130px]")}>Against</th>
            <th scope="col" className={cn(th, "w-[110px] text-right")}>Amount</th>
            <th scope="col" className={cn(th, "w-[220px]")}>Reason</th>
            <th scope="col" className={cn(th, "w-[180px]")}>Reconciliation</th>
            <th scope="col" className={cn(th, "w-[160px]")}>Status</th>
            <th scope="col" className={cn(th, "w-[180px] text-right")}><span className="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={8} className="p-0">
                {anyFilter ? <NoMatches noun="credit notes" onClear={() => change({ lens: "all", q: "" })} /> : (
                  <EmptyState title="No refunds or credits yet" hint="Raise one from a paid invoice when money needs to go back or be written off." />
                )}
              </td>
            </tr>
          ) : shown.map((note) => {
            const reconciliation = CREDIT_NOTE_RECONCILIATION[note.reconciliation_state ?? "pending"] ?? note.reconciliation_state ?? "—";
            const action = note.status === "pending_approval" || note.reconciliation_state === "provider_pending";
            return (
              <tr
                key={note.id}
                {...left.rowProps(note.id)}
                onClick={() => router.push(sheetHref(note.id), { scroll: false })}
                aria-selected={openId === note.id || undefined}
                className={cn("cursor-pointer hover:bg-[var(--surface-alt)]", openId === note.id && "bg-[var(--primary-soft)]")}
              >
                <td className={cn(td, "whitespace-nowrap")}>
                  <Link href={sheetHref(note.id)} scroll={false} onClick={(event) => event.stopPropagation()} className="font-semibold text-[var(--ink)] tabular-nums hover:underline">{note.number}</Link>
                  <span className="ml-1.5 text-xs text-[var(--muted)]"><span className="capitalize">{note.type}</span> · {fullDate(note.created_at)}</span>
                </td>
                <td className={cn(td, "max-w-[240px] truncate")}>{note.tenants?.name ?? "—"}</td>
                <td className={cn(td, "whitespace-nowrap tabular-nums")}>
                  {note.invoice
                    ? <Link href={`/admin/invoices?invoice=${note.invoice.id}`} onClick={(event) => event.stopPropagation()} className="font-semibold text-[var(--ink)] hover:underline">{note.invoice.number}</Link>
                    : <span className="text-[var(--muted)]">No invoice</span>}
                </td>
                <td className={cn(td, "text-right font-semibold text-[var(--ink)] tabular-nums")}>{formatCentsAsCurrency(note.amount_cents)}</td>
                <td className={cn(td, "max-w-[220px] truncate")} title={note.reason_text ?? undefined}>{CREDIT_REASON_LABELS[note.reason_code]}{note.reason_text ? ` — ${note.reason_text}` : ""}</td>
                <td className={cn(td, "max-w-[180px] truncate")} title={note.last_reconciliation_error && note.reconciliation_state !== "reconciled" ? note.last_reconciliation_error : undefined}>{reconciliation}</td>
                <td className={cn(td, "whitespace-nowrap")}>
                  <StatusChip tone={note.status === "pending_approval" && note.requested_by === currentAdminId ? "neutral" : CREDIT_NOTE_TONE[note.status] ?? "neutral"} dot>
                    {note.status === "pending_approval" && note.requested_by === currentAdminId ? "Raised by you" : CREDIT_NOTE_STATUS_LABEL[note.status] ?? note.status.replace(/_/g, " ")}
                  </StatusChip>
                </td>
                <td className={cn(td, "text-right")}>
                  {action ? <CreditNoteAction note={note} currentAdminId={currentAdminId} /> : <ChevronRight className="ml-auto size-4 text-[var(--muted)]" aria-hidden="true" />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableCard>
  );
}
