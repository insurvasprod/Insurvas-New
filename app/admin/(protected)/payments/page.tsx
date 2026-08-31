import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { AdminPageHeader } from "@/components/admin/page-header";
import { PaymentStatusPanel } from "@/components/admin/payment-status-panel";
import { getProviderStatus } from "@/lib/payments/status";

export default async function PaymentsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone.
  if (!canAccessConfigurationSection(admin.role, "payments")) redirect("/admin");

  const status = await getProviderStatus();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* "Setup" to match the sidebar. The subtitle carries what it is setup FOR, so the heading
          does not have to. */}
      <AdminPageHeader title="Setup" subtitle="Payment providers, modes, keys, and payment health." />
      <PaymentStatusPanel status={status} />
    </div>
  );
}
