import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { OffersTable } from "@/components/admin/offers-table";
import { fetchOffers } from "@/lib/offers/queries";
import { fetchPlans } from "@/lib/plans/queries";
import { fetchSubscriptions } from "@/lib/subscriptions/queries";

export default async function OffersPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone.
  if (!canAccessConfigurationSection(admin.role, "offers")) redirect("/admin");

  const [offers, plans, subscriptions] = await Promise.all([fetchOffers(), fetchPlans(), fetchSubscriptions()]);

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {/* A cancelled subscription can never be targeted, so it is never offered in Apply. */}
      <OffersTable initialOffers={offers} plans={plans} subscriptions={subscriptions.filter((item) => item.status !== "cancelled")} now={new Date().getTime()} />
    </div>
  );
}
