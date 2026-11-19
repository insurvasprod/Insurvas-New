import { Suspense } from "react";
import { redirect } from "next/navigation";

import { BillingPage } from "@/components/admin/billing/billing-page";
import { WsExportMenu } from "@/components/admin/billing/ws-export-menu";
import { WsPanelLoading } from "@/components/admin/billing/ws-panel";
import { WsComingUp, WsFigures, WsFiguresLoading, WsHappened, WsNeeds } from "@/components/admin/billing/ws-sections";
import { CustomInvoiceDialog } from "@/components/admin/custom-invoice-dialog";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** This month and the five before it, for Export month: "2026-11" · "November 2026". */
function exportMonths(): { key: string; label: string }[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, back) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return { key: date.toISOString().slice(0, 7), label: `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}${back === 0 ? " (so far)" : ""}` };
  });
}

/**
 * Admin › Billing workspace (admin round 1, docs/design/admin-r1/billing-r2.html screen 1). Replaces the four link
 * cards (their destinations are every step in the rail now): the billing figures with their trend lines, Needs
 * you from the billing checks (worst first, each opening its page filtered), what is coming up in the next seven
 * days and what just happened. Each part streams and fails on its own; the rail and the title show at once.
 */
export default async function BillingWorkspacePage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewInvoices(admin.role)) redirect("/admin");

  // The custom invoice's customer list. A failed read must not offer an empty picker: the route's error page says so.
  const { data: tenants, error } = await getSupabaseServiceClient().from("tenants").select("id, name").order("name");
  if (error) throw new Error(`Could not load customers: ${error.message}`);
  const viewer = { id: admin.id, role: admin.role };

  return (
    <BillingPage
      step="workspace"
      title="Billing"
      info="Billing at a glance: the figures, what needs you, what's coming up in the next seven days and what just happened."
      actions={
        <>
          <WsExportMenu months={exportMonths()} />
          <CustomInvoiceDialog tenants={tenants ?? []} triggerLabel="Raise a custom invoice" triggerClassName={buttonVariants({ variant: "highlight" })} />
        </>
      }
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <Suspense fallback={<WsFiguresLoading />}>
          <WsFigures role={admin.role} />
        </Suspense>
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Suspense fallback={<WsPanelLoading title="Needs you" rows={6} />}>
            <WsNeeds viewer={viewer} />
          </Suspense>
          <div className="flex min-w-0 flex-col gap-4">
            <Suspense fallback={<WsPanelLoading title="Coming up · 7 days" rows={5} />}>
              <WsComingUp role={admin.role} />
            </Suspense>
            <Suspense fallback={<WsPanelLoading title="Just happened" rows={5} />}>
              <WsHappened viewer={viewer} />
            </Suspense>
          </div>
        </div>
      </div>
    </BillingPage>
  );
}
