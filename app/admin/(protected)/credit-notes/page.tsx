import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { BillingPage } from "@/components/admin/billing/billing-page";
import { CreditNoteSheet } from "@/components/admin/billing/refund-note-sheet";
import { CreditNotesTable, type CreditNoteRow } from "@/components/admin/credit-notes-table";
import { RaiseCreditNotePicker, type PaidInvoice } from "@/components/admin/raise-credit-note-picker";
import { formatCentsAsCurrency } from "@/lib/money";
import { fetchCreditNoteRecord } from "@/lib/invoices/creditNoteTrail";
import { refundApprovalThresholdCents } from "@/lib/settings/queries";

/**
 * Admin › Billing › Refunds & credits (billing-r2 screen 6). Kept: the approval threshold in words, the four
 * figures, the pending / failed / awaiting-reconciliation warnings (now the status line), the columns, Approve
 * (never for the raiser) and Retry reconciliation, refresh and the pager. New: lenses and search in the address,
 * the Reason column, raising a credit note in place, and a credit note's sheet with its approval trail.
 *
 * Address parameters: lens=approval|failed|reconciliation (also pending, provider_pending), q=<text>,
 * note=<credit note id> opens its sheet, raise=<paid invoice id> opens the raise sheet on that invoice.
 */
export default async function CreditNotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const query = await searchParams;
  const noteId = typeof query.note === "string" ? query.note : null;
  const supabase = getSupabaseServiceClient();
  const [thresholdCents, notesResult, paidResult, record] = await Promise.all([
    refundApprovalThresholdCents(),
    supabase.from("credit_notes").select("*, tenants(name), invoice:platform_invoices(id, number)").order("created_at", { ascending: false }),
    supabase.from("platform_invoices").select("id, number, tenant_id, total_cents, provider_payment_id, paid_at, tenants(name)").eq("status", "paid").order("number", { ascending: false }).limit(500),
    noteId ? fetchCreditNoteRecord(noteId) : Promise.resolve(null),
  ]);

  // This screen holds the pending-approval queue. A failed query renders it empty, which reads as
  // "nothing is waiting on you" — the one wrong answer, since a refund sitting unapproved is the
  // whole reason to open the page.
  if (notesResult.error) throw new Error(`Could not load credit notes: ${notesResult.error.message}`);

  const notes = (notesResult.data ?? []) as unknown as CreditNoteRow[];
  const pending = notes.filter((n) => n.status === "pending_approval");
  const ownPending = pending.filter((n) => n.requested_by === admin.id);
  const failed = notes.filter((n) => n.status === "failed");
  const providerPending = notes.filter((n) => n.reconciliation_state === "provider_pending");
  const totalCents = notes.reduce((sum, n) => sum + n.amount_cents, 0);
  const paid: PaidInvoice[] = ((paidResult.data ?? []) as unknown as Array<Omit<PaidInvoice, "tenant_name"> & { tenants: { name: string } | null }>)
    .map(({ tenants, ...row }) => ({ ...row, tenant_name: tenants?.name ?? "—" }));

  return (
    <BillingPage
      step="refunds"
      info={`Refunds above ${formatCentsAsCurrency(thresholdCents)} need a second admin.`}
      actions={<RaiseCreditNotePicker invoices={paid} approvalThresholdCents={thresholdCents} />}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <StatStrip label="Credit note totals">
          <StatTile label="Credit notes" value={notes.length.toLocaleString("en-US")} footnote={`all time · ${formatCentsAsCurrency(totalCents)}`} />
          <StatTile label="Pending approval" value={pending.length.toLocaleString("en-US")} footnote={ownPending.length > 0 ? `${ownPending.length.toLocaleString("en-US")} raised by you` : pending.length > 0 ? "needs a second admin" : "none waiting"} href={pending.length > 0 ? "/admin/credit-notes?lens=approval" : undefined} />
          <StatTile label="Failed" value={failed.length.toLocaleString("en-US")} footnote={failed.length > 0 ? "at the provider" : "none failed"} href={failed.length > 0 ? "/admin/credit-notes?lens=failed" : undefined} />
          <StatTile label="Awaiting reconciliation" value={providerPending.length.toLocaleString("en-US")} footnote={providerPending.length > 0 ? "provider not confirmed" : "all reconciled"} href={providerPending.length > 0 ? "/admin/credit-notes?lens=reconciliation" : undefined} />
        </StatStrip>

        <CreditNotesTable notes={notes} currentAdminId={admin.id} />
      </div>
      {record && <CreditNoteSheet note={record} currentAdminId={admin.id} />}
    </BillingPage>
  );
}
