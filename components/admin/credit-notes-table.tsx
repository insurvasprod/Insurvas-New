"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { EmptyState } from "@/components/admin/empty-state";
import { StatusChip, type StatusTone } from "@/components/admin/status-chip";
import { fullDate } from "@/components/admin/tenant-record/billing-format";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { TableCard } from "@/components/ui/table-card";
import { formatCentsAsCurrency } from "@/lib/money";
import { CREDIT_REASON_LABELS, type CreditReason } from "@/lib/credits/rules";
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

/** Money that failed is danger; money still waiting on a human is warning. */
const CREDIT_NOTE_TONE: Record<string, StatusTone> = {
  pending_approval: "warning",
  approved: "info",
  processing: "neutral",
  succeeded: "good",
  failed: "danger",
  rejected: "neutral",
};
const STATUS_LABEL: Record<string, string> = {
  pending_approval: "Pending approval",
  approved: "Approved",
  processing: "Processing",
  succeeded: "Succeeded",
  failed: "Failed at provider",
  rejected: "Rejected",
};
/** The local ledger's side of a refund, after the provider has answered. */
const RECONCILIATION: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: "Not started", tone: "neutral" },
  provider_pending: { label: "Awaiting reconciliation", tone: "warning" },
  reconciled: { label: "Reconciled", tone: "good" },
  failed: { label: "Reconciliation failed", tone: "danger" },
};

const PAGE = 25;
const th = "px-3 py-2 text-left text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const td = "border-t border-[var(--border)] px-3 py-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]";

/**
 * The refunds & credits table (p-adm-credit-notes): every credit note, what it was raised against,
 * where the money stands and where our ledger stands. Approve and Retry reconciliation stay on the
 * row that needs them — the board's table shows state, and the actions are this screen's reason to
 * exist.
 */
export function CreditNotesTable({ notes, currentAdminId }: { notes: CreditNoteRow[]; currentAdminId: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(notes.length / PAGE));
  const current = Math.min(page, pages);
  const shown = useMemo(() => notes.slice((current - 1) * PAGE, current * PAGE), [notes, current]);

  async function act(note: CreditNoteRow, action: "approve" | "reconcile") {
    setBusy(note.id);
    const res = await fetch(`/api/admin/credit-notes/${note.id}/${action}`, { method: "POST" });
    const body = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) {
      notify.block(body?.error ?? (action === "approve" ? "Could not approve" : "Could not reconcile"));
      return;
    }
    notify.done(body?.message ?? `${note.number} ${action === "approve" ? "approved" : "reconciled"}`);
    router.refresh();
  }

  return (
    <TableCard
      className="min-w-0"
      toolbar={<DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />} />}
    >
        <table className="w-full min-w-[920px] border-collapse">
          <thead>
            <tr className="bg-[var(--surface-alt)]">
              <th scope="col" className={cn(th, "w-[170px]")}>Credit note</th>
              <th scope="col" className={th}>Tenant</th>
              <th scope="col" className={cn(th, "w-[170px]")}>Against</th>
              <th scope="col" className={cn(th, "w-[120px] text-right")}>Amount</th>
              <th scope="col" className={cn(th, "w-[170px]")}>Status</th>
              <th scope="col" className={cn(th, "w-[200px]")}>Reconciliation</th>
              <th scope="col" className={cn(th, "w-[190px] text-right")}><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {notes.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-0">
                  <EmptyState title="No refunds or credits yet" hint="Raise one from a paid invoice when money needs to go back or be written off." />
                </td>
              </tr>
            ) : shown.map((note) => {
              const isOwn = note.requested_by === currentAdminId;
              const pending = note.status === "pending_approval";
              const reconciliation = RECONCILIATION[note.reconciliation_state ?? "pending"] ?? { label: note.reconciliation_state ?? "—", tone: "neutral" as StatusTone };
              const providerPending = note.reconciliation_state === "provider_pending";
              return (
                <tr key={note.id} className="align-top hover:bg-[color-mix(in_srgb,var(--primary),transparent_95%)]">
                  <td className={td}>
                    <span className="font-semibold text-[var(--ink)] tabular-nums">{note.number}</span>
                    <span className="block text-[12px] text-[var(--muted)]"><span className="capitalize">{note.type}</span> · {fullDate(note.created_at)}</span>
                  </td>
                  <td className={td}>
                    {note.tenants?.name ?? "—"}
                    <span className="block text-[12px] text-[var(--muted)]">{CREDIT_REASON_LABELS[note.reason_code]}{note.reason_text ? ` — ${note.reason_text}` : ""}</span>
                  </td>
                  <td className={cn(td, "tabular-nums")}>
                    {note.invoice ? <Link href={`/admin/invoices/${note.invoice.id}`} className="font-semibold text-[var(--ink)] hover:underline">{note.invoice.number}</Link> : <span className="text-[var(--muted)]">No invoice</span>}
                  </td>
                  <td className={cn(td, "text-right font-semibold text-[var(--ink)] tabular-nums")}>{formatCentsAsCurrency(note.amount_cents)}</td>
                  <td className={td}><StatusChip tone={CREDIT_NOTE_TONE[note.status] ?? "neutral"} dot>{STATUS_LABEL[note.status] ?? note.status.replace(/_/g, " ")}</StatusChip></td>
                  <td className={td}>
                    <StatusChip tone={reconciliation.tone}>{reconciliation.label}</StatusChip>
                    {note.last_reconciliation_error && note.reconciliation_state !== "reconciled" && <span className="mt-1 block max-w-[220px] text-[12px] text-[var(--muted)]">{note.last_reconciliation_error}</span>}
                  </td>
                  <td className={cn(td, "text-right")}>
                    {providerPending ? (
                      <Button type="button" variant="outline" size="sm" disabled={busy === note.id} onClick={() => void act(note, "reconcile")}>Retry reconciliation</Button>
                    ) : pending ? (
                      isOwn ? (
                        // Shown rather than hidden: the person waiting needs to know WHY they cannot act.
                        <span className="text-[12px] text-[var(--muted)]">You raised this — a second admin must approve</span>
                      ) : (
                        <Button type="button" size="sm" disabled={busy === note.id} onClick={() => void act(note, "approve")}>Approve</Button>
                      )
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      {notes.length > 0 && <BoardTableFooter page={current} pageSize={PAGE} total={notes.length} itemLabel={notes.length === 1 ? "credit note" : "credit notes"} order="newest first" onPageChange={setPage} />}
    </TableCard>
  );
}
