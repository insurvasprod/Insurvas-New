import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices, canVoidInvoices } from "@/lib/invoices/permissions";
import { computeInvoiceTotals, fetchInvoices } from "@/lib/invoices/queries";
import { BillingPage } from "@/components/admin/billing/billing-page";
import { InvoicesTable } from "@/components/admin/invoices-table";
import { InvoiceSheet, loadInvoiceView } from "@/components/admin/invoice-detail-view";
import { CustomInvoiceDialog } from "@/components/admin/custom-invoice-dialog";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Admin › Billing › Invoices (billing-r2 screen 5). Everything today's page had — the four figures, the
 * list with its search, customer and status filters, the lenses, refresh, the pager, the custom invoice — in
 * the Billing frame, plus the overdue age, the Issued filter, select-and-export, and the invoice as a wide sheet.
 *
 * Address parameters (all optional, for links from the Billing workspace and elsewhere):
 *   lens=all|overdue|mismatched (also late, mismatch, dont-match; or overdue=1 / mismatched=1)
 *   age=0-30|31-60|60+   q=<text>   tenant=<tenant id> (or customer=)   status=<invoice status>
 *   issued=this-month|last-month|90d|this-year   invoice=<invoice id> opens that invoice's sheet
 */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // SA-3.3: a support_agent cannot open invoice screens at all.
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const query = await searchParams;
  const openId = typeof query.invoice === "string" ? query.invoice : null;
  const supabase = getSupabaseServiceClient();
  const [invoices, { data: tenants }, sheet] = await Promise.all([
    fetchInvoices(),
    supabase.from("tenants").select("id, name").order("name"),
    openId ? loadInvoiceView(openId) : Promise.resolve(null),
  ]);
  // The same unfiltered rows the table starts from, so the strip and the list cannot disagree and
  // the whole invoice table is read once rather than twice.
  const totals = computeInvoiceTotals(invoices);
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const invoicedThisMonthCount = invoices.filter((i) => new Date(i.created_at) >= startOfMonth && i.status !== "void").length;

  return (
    <BillingPage
      step="invoices"
      info="What we billed, and whether it matches what the provider charged."
      actions={<CustomInvoiceDialog tenants={tenants ?? []} triggerLabel="Raise a custom invoice" triggerSize="default" triggerVariant="highlight" />}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <InvoicesTable initialInvoices={invoices} totals={totals} invoicedThisMonthCount={invoicedThisMonthCount} tenants={tenants ?? []} now={new Date().getTime()} />
      </div>
      {sheet && <InvoiceSheet view={sheet} canAct={canVoidInvoices(admin.role)} />}
    </BillingPage>
  );
}
