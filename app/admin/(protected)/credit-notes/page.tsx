import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { Callout } from "@/components/app/settings/primitives";
import { PageHeader } from "@/components/ui/page-header";
import { BillingTabs } from "@/components/admin/billing-tabs";
import { CreditNotesTable, type CreditNoteRow } from "@/components/admin/credit-notes-table";
import { RaiseCreditNotePicker } from "@/components/admin/raise-credit-note-picker";
import { formatCentsAsCurrency } from "@/lib/money";
import { refundApprovalThresholdCents } from "@/lib/settings/queries";

export default async function CreditNotesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const supabase = getSupabaseServiceClient();
  const [thresholdCents, notesResult, paidResult] = await Promise.all([
    refundApprovalThresholdCents(),
    supabase.from("credit_notes").select("*, tenants(name), invoice:platform_invoices(id, number)").order("created_at", { ascending: false }),
    supabase.from("platform_invoices").select("id, number, total_cents, tenants(name)").eq("status", "paid").order("number", { ascending: false }).limit(500),
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
  const paid = ((paidResult.data ?? []) as unknown as Array<{ id: string; number: string; total_cents: number; tenants: { name: string } | null }>).map((row) => ({ id: row.id, number: row.number, total_cents: row.total_cents, tenant_name: row.tenants?.name ?? "—" }));
  const names = (rows: CreditNoteRow[]) => rows.slice(0, 3).map((n) => n.number).join(", ") + (rows.length > 3 ? ` and ${rows.length - 3} more` : "");

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Refunds & credits"
        description={`Refunds above ${formatCentsAsCurrency(thresholdCents)} need a second admin.`}
        actions={<RaiseCreditNotePicker invoices={paid} />}
      />
      <BillingTabs />

      {(pending.length > 0 || failed.length > 0 || providerPending.length > 0) && (
        <div className="flex flex-col gap-2">
          {pending.length > 0 && (
            <Callout
              tone="warning"
              title={`${pending.length} pending approval — no money moves until a second admin approves${ownPending.length > 0 ? `; ${names(ownPending)} ${ownPending.length === 1 ? "is" : "are"} yours, so another admin must approve` : ""}.`}
            />
          )}
          {failed.length > 0 && (
            <Callout tone="error" title={`${failed.length} failed at the provider (${names(failed)}) — investigate before retrying; the money may or may not have moved.`} />
          )}
          {providerPending.length > 0 && (
            <Callout tone="warning" title={`${providerPending.length} awaiting reconciliation — use Retry reconciliation; do not raise a second credit note.`} />
          )}
        </div>
      )}

      <CreditNotesTable notes={notes} currentAdminId={admin.id} />
    </div>
  );
}
