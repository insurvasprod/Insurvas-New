"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCentsAsCurrency } from "@/lib/money";
import { CREDIT_REASON_LABELS, type CreditReason } from "@/lib/credits/rules";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";

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

const STATUS_STYLE: Record<string, string> = {
  pending_approval: "border-transparent bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
  approved: "border-transparent bg-[var(--brand-700)]/10 text-[var(--brand-700)]",
  processing: "border-transparent bg-muted text-muted-foreground",
  succeeded: "border-transparent bg-[var(--color-success)]/10 text-[var(--color-success)]",
  failed: "border-transparent bg-destructive/10 text-destructive",
  rejected: "border-transparent bg-muted text-muted-foreground",
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
              <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                No refunds or credits yet.
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
                    <Badge variant="outline" className={STATUS_STYLE[note.status] ?? ""}>
                      {note.status.replace("_", " ")}
                    </Badge>
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
