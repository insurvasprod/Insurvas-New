import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { computeInvoiceTotals, fetchInvoices } from "@/lib/invoices/queries";
import { AdminPageHeader } from "@/components/admin/page-header";
import { BillingTabs } from "@/components/admin/billing-tabs";
import { InvoicesTable } from "@/components/admin/invoices-table";
import { CustomInvoiceDialog } from "@/components/admin/custom-invoice-dialog";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const PRIMARY_44 =
  "inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-transparent bg-[var(--primary)] px-4 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--on-primary)] hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

export default async function InvoicesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // SA-3.3: a support_agent cannot open invoice screens at all.
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const supabase = getSupabaseServiceClient();
  const [invoices, { data: tenants }] = await Promise.all([
    fetchInvoices(),
    supabase.from("tenants").select("id, name").order("name"),
  ]);
  // The same unfiltered rows the table starts from, so the strip and the list cannot disagree and
  // the whole invoice table is read once rather than twice.
  const totals = computeInvoiceTotals(invoices);
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const invoicedThisMonthCount = invoices.filter((i) => new Date(i.created_at) >= startOfMonth && i.status !== "void").length;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <AdminPageHeader
        title="Invoices"
        subtitle="What we billed, and whether it matches what the provider charged."
        actions={<CustomInvoiceDialog tenants={tenants ?? []} triggerLabel="Raise a custom invoice" triggerClassName={PRIMARY_44} />}
      />
      <BillingTabs />
      <InvoicesTable initialInvoices={invoices} totals={totals} invoicedThisMonthCount={invoicedThisMonthCount} tenants={tenants ?? []} now={new Date().getTime()} />
    </div>
  );
}
