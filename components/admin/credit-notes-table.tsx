"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/admin/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCentsAsCurrency } from "@/lib/money";
import { CREDIT_REASON_LABELS, type CreditReason } from "@/lib/credits/rules";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";
import { StatusChip, type StatusTone } from "@/components/admin/status-chip";

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
  tenants: { name: string } | null;
  invoices: { number: string } | null;
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


export function CreditNotesTable({
  notes,
  currentAdminId,
}: {
  notes: CreditNoteRow[];
  currentAdminId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function approve(note: CreditNoteRow) {
    setBusy(note.id);
    const res = await fetch(`/api/admin/credit-notes/${note.id}/approve`, { method: "POST" });
    const body = await res.json().catch(() => null);
    setBusy(null);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not approve");
      return;
    }

    toast.success(body.message ?? `${note.number} approved`);
    router.refresh();
  }

  return (
    <div className={tableShell}>
      <Table>
        <TableHeader>
          <TableRow className={tableHeaderRow}>
            <TableHead className={tableHeadCell}>Number</TableHead>
            <TableHead className={tableHeadCell}>Tenant</TableHead>
            <TableHead className={tableHeadCell}>Type</TableHead>
            <TableHead className={tableHeadCell}>Amount</TableHead>
            <TableHead className={tableHeadCell}>Reason</TableHead>
            <TableHead className={tableHeadCell}>Status</TableHead>
            <TableHead className={tableHeadCell}></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {notes.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="p-0">
                <EmptyState
                  title="No refunds or credits yet"
                  hint="Raised from an invoice when money needs to go back or be written off. Every one needs a reason, and anything above the approval threshold needs a second approver."
                />
              </TableCell>
            </TableRow>
          ) : (
            notes.map((note) => {
              const isOwn = note.requested_by === currentAdminId;
              const pending = note.status === "pending_approval";

              return (
                <TableRow key={note.id}>
                  <TableCell className="font-mono font-medium">{note.number}</TableCell>
                  <TableCell>{note.tenants?.name ?? "—"}</TableCell>
                  <TableCell className="capitalize">{note.type}</TableCell>
                  <TableCell className="font-medium">{formatCentsAsCurrency(note.amount_cents)}</TableCell>
                  <TableCell className="text-sm">
                    {CREDIT_REASON_LABELS[note.reason_code]}
                    {note.reason_text && (
                      <span className="block text-xs text-muted-foreground">{note.reason_text}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusChip tone={CREDIT_NOTE_TONE[note.status] ?? "neutral"} dot>
                      {note.status.replace("_", " ")}
                    </StatusChip>
                  </TableCell>
                  <TableCell className="text-right">
                    {pending &&
                      (isOwn ? (
                        // Shown rather than hidden: the person waiting needs to know WHY they
                        // cannot act, not merely find no button.
                        <span className="text-xs text-muted-foreground">
                          You raised this — a second admin must approve
                        </span>
                      ) : (
                        <Button size="sm" disabled={busy === note.id} onClick={() => approve(note)}>
                          Approve
                        </Button>
                      ))}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
