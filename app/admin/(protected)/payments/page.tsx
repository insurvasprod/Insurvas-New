import { redirect } from "next/navigation";

import { PaymentStatusPanel } from "@/components/admin/payment-status-panel";
import { AdminPageHeader } from "@/components/admin/page-header";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canConfigureProvider } from "@/lib/payments/permissions";
import { getProviderStatus } from "@/lib/payments/status";

/**
 * Standalone provider status screen for SA-4.2.
 *
 * This page intentionally is not added to the sidebar. SA-4.3 can register this surface inside
 * the Configuration Center without changing the admin shell or moving provider configuration into
 * the settings store.
 */
export default async function PaymentsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canConfigureProvider(admin.role)) redirect("/admin");

  const status = await getProviderStatus();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <AdminPageHeader
        title="Payment provider"
        subtitle="What the platform is configured to call, and whether recent calls are healthy"
      />
      <PaymentStatusPanel status={status} />
    </div>
  );
}
