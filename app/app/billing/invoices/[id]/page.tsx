import { notFound, redirect } from "next/navigation";

import { InvoicePrintView } from "@/components/admin/invoice-print-view";
import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * LA-8.5 · An invoice, printable or saved as a PDF, from Settings › Plan & billing. The same document
 * staff print (SA-3.3), outside the app shell so the paper carries no chrome. Owners only, their own
 * agency's invoices only, and never a draft.
 */
export default async function TenantInvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");
  if (context.role !== "owner") redirect("/app/settings");

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: invoice } = await getSupabaseServiceClient()
    .from("platform_invoices")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle<{ id: string; status: string }>();
  if (!invoice || invoice.status === "draft") notFound();

  return <InvoicePrintView id={invoice.id} back={{ href: "/app/settings#billing", label: "Back to billing" }} />;
}
