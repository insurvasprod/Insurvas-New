import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminPageHeader } from "@/components/admin/page-header";
import { CreditNotesTable, type CreditNoteRow } from "@/components/admin/credit-notes-table";
import { Card, CardContent } from "@/components/ui/card";
import { formatCentsAsCurrency } from "@/lib/money";
import { REFUND_APPROVAL_THRESHOLD_CENTS } from "@/lib/credits/rules";

export default async function CreditNotesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("credit_notes")
    .select("*, tenants(name), invoices(number)")
    .order("created_at", { ascending: false });

  const notes = (data ?? []) as unknown as CreditNoteRow[];
  const pending = notes.filter((n) => n.status === "pending_approval");
  const failed = notes.filter((n) => n.status === "failed");

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Refunds & credits"
        subtitle={`Refunds above ${formatCentsAsCurrency(REFUND_APPROVAL_THRESHOLD_CENTS)} need a second admin`}
      />

      {pending.length > 0 && (
        <Card className="border-[var(--color-warning)]/40">
          <CardContent>
            <p className="text-sm font-medium text-[var(--color-warning)]">
              {pending.length} request{pending.length === 1 ? "" : "s"} waiting for approval
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              No money moves until a second admin approves. You cannot approve one you raised yourself.
            </p>
          </CardContent>
        </Card>
      )}

      {failed.length > 0 && (
        <Card className="border-destructive/40">
          <CardContent>
            <p className="text-sm font-medium text-destructive">
              {failed.length} refund{failed.length === 1 ? "" : "s"} failed at the provider
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              The credit note is kept in <code>failed</code> so the attempt is on record. Investigate before
              retrying — the money may or may not have moved.
            </p>
          </CardContent>
        </Card>
      )}

      <CreditNotesTable notes={notes} currentAdminId={admin.id} />
    </div>
  );
}
