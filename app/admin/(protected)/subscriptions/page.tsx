import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManageSubscriptions } from "@/lib/subscriptions/permissions";
import { fetchSubscriptions } from "@/lib/subscriptions/queries";
import { fetchPlans } from "@/lib/plans/queries";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SubscriptionsTable } from "@/components/admin/subscriptions-table";

export default async function SubscriptionsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManageSubscriptions(admin.role)) redirect("/admin");

  const [subscriptions, plans] = await Promise.all([fetchSubscriptions(), fetchPlans()]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader
        title="Subscriptions"
        subtitle="Who is on what, and what's queued to change. Assign and cancel from a tenant's page."
      />
      <SubscriptionsTable
        initialSubscriptions={subscriptions}
        plans={plans.map((p) => ({ id: p.id, name: p.name, version: p.version }))}
      />
    </div>
  );
}
