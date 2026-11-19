import Link from "next/link";

import { formatUtcDateTime } from "@/lib/adminDashboard/figures";
import { CREDIT_REASON_LABELS, type CreditReason } from "@/lib/credits/rules";
import type { CreditNoteRecord } from "@/lib/invoices/creditNoteTrail";
import { formatCentsAsCurrency } from "@/lib/money";
import { StatusChip } from "@/components/admin/status-chip";
import { CreditNoteAction } from "@/components/admin/credit-notes-table";
import { CREDIT_NOTE_RECONCILIATION, CREDIT_NOTE_STATUS_LABEL, CREDIT_NOTE_TONE } from "@/lib/invoices/creditNotesView";
import { RecordSheet } from "@/components/admin/billing/inv-sheet";
import { FactTable } from "@/components/ui/fact-table";

/**
 * A credit note as a right sheet over Refunds & credits (`?note=<id>`, billing-r2 screen 6): what it is, against
 * which invoice, why, where the money and our ledger stand, and its approval trail from the audit log — who
 * raised it, who approved it, each reconciliation retry. Approve (never the raiser) and Retry sit in its footer.
 */
export function CreditNoteSheet({ note, currentAdminId }: { note: CreditNoteRecord; currentAdminId: string }) {
  const ownPending = note.status === "pending_approval" && note.requested_by === currentAdminId;
  const reason = `${CREDIT_REASON_LABELS[note.reason_code as CreditReason] ?? note.reason_code}${note.reason_text ? ` — ${note.reason_text}` : ""}`;
  const canAct = note.status === "pending_approval" || note.reconciliation_state === "provider_pending";

  return (
    <RecordSheet
      param="note"
      title={`${note.number} · ${note.tenant_name}`}
      subtitle={`${note.type.charAt(0).toUpperCase()}${note.type.slice(1)} of ${formatCentsAsCurrency(note.amount_cents)} · raised ${formatUtcDateTime(note.created_at)}`}
      status={<StatusChip tone={ownPending ? "neutral" : CREDIT_NOTE_TONE[note.status] ?? "neutral"} dot>{ownPending ? "Raised by you" : CREDIT_NOTE_STATUS_LABEL[note.status] ?? note.status}</StatusChip>}
      footer={canAct ? <><span className="flex-1" /><CreditNoteAction note={note} currentAdminId={currentAdminId} size="default" /></> : undefined}
    >
      <FactTable
        rows={[
          ["Customer", <Link key="c" href={`/admin/tenants/${note.tenant_id}`} className="font-semibold hover:underline">{note.tenant_name}</Link>],
          ["Amount", <span key="a" className="font-semibold">{formatCentsAsCurrency(note.amount_cents)}</span>],
          ["Against", note.invoice ? <Link key="i" href={`/admin/invoices?invoice=${note.invoice.id}`} className="font-semibold hover:underline">{note.invoice.number}</Link> : "No invoice"],
          ["Reason", reason],
          ["Raised by", note.requested_by_name ?? (note.requested_by ? "An admin" : null)],
          ["Approved by", note.approved_by_name ? `${note.approved_by_name}${note.approved_at ? ` · ${formatUtcDateTime(note.approved_at)}` : ""}` : null],
          ["Reconciliation", `${CREDIT_NOTE_RECONCILIATION[note.reconciliation_state] ?? note.reconciliation_state}${note.reconciliation_attempts > 0 ? ` · ${note.reconciliation_attempts} ${note.reconciliation_attempts === 1 ? "attempt" : "attempts"}` : ""}`],
          ["Last error", note.reconciliation_state !== "reconciled" ? note.last_reconciliation_error : null],
          ["Provider said", note.failure_reason],
          ["Rejected because", note.rejected_reason],
          ["Provider refund", note.provider_refund_id],
        ]}
      />

      <section aria-labelledby="note-trail">
        <h3 id="note-trail" className="m-0 mb-2 text-sm font-semibold text-foreground">Approval trail</h3>
        {note.trail.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">Nothing recorded in the audit log for this credit note yet.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {note.trail.map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span className="mt-1.5 size-[7px] shrink-0 rounded-full bg-[var(--muted)]" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{entry.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                    {[entry.who, formatUtcDateTime(entry.at), entry.detail].filter(Boolean).join(" · ")}
                  </span>
                  {entry.reason && <span className="mt-0.5 block text-xs text-muted-foreground">{entry.reason}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </RecordSheet>
  );
}
