import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { fetchInvoices, fetchInvoiceTotals } from "@/lib/invoices/queries";
import { AdminPageHeader } from "@/components/admin/page-header";
import { InvoicesTable } from "@/components/admin/invoices-table";
import { CustomInvoiceDialog } from "@/components/admin/custom-invoice-dialog";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { Card, CardContent } from "@/components/ui/card";
import { formatCentsAsCurrency } from "@/lib/money";

export default async function InvoicesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // SA-3.3: a support_agent cannot open invoice screens at all.
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const supabase = getSupabaseServiceClient();
  const [invoices, totals, { data: tenants }] = await Promise.all([
    fetchInvoices(),
    fetchInvoiceTotals(),
    supabase.from("tenants").select("id, name").order("name"),
  ]);

  // "Outstanding" and "overdue" are structurally zero while Whop collects before we hear, so the
  // third tile is the number that actually carries information in a reconciliation model: invoices
  // where what we billed disagrees with what the customer was charged.
  const tiles = [
    { label: "Invoiced this month", value: formatCentsAsCurrency(totals.invoicedThisMonthCents) },
    { label: "Collected this month", value: formatCentsAsCurrency(totals.collectedThisMonthCents) },
    {
      label: "Mismatched",
      value: String(totals.mismatchedCount),
      alert: totals.mismatchedCount > 0,
      hint: "We billed a different amount to the one the customer was charged",
    },
    { label: "Overdue", value: String(totals.overdueCount) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <AdminPageHeader title="Invoices" subtitle="What we billed, and whether it matches what was charged" />
        <CustomInvoiceDialog tenants={tenants ?? []} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <CardContent>
              <p className="text-sm text-muted-foreground" title={tile.hint}>
                {tile.label}
              </p>
              <p
                className="mt-1 text-2xl font-bold"
                style={tile.alert ? { color: "var(--color-warning)" } : undefined}
              >
                {tile.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <InvoicesTable initialInvoices={invoices} />
    </div>
  );
}
