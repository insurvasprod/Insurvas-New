import type { Metadata } from "next";

import { PricingPage } from "@/components/public/pricing-page";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";
import { fetchPublicAddons } from "@/lib/publicPlans/addons";
import { fetchPublicPlans } from "@/lib/publicPlans/queries";

export const metadata: Metadata = {
  title: "Pricing · Insurvas",
  description: "Choose an Insurvas plan and start your trial.",
};

/** Read on every request: a price published in the admin catalog shows here at once. */
export const dynamic = "force-dynamic";

/**
 * Plans and add-ons are read on the server and handed to the page, so there is no loading state
 * and no client call to the rate-limited /api/public/plans (signup still uses it). A failed plan
 * read shows the page's error state; a failed add-on read just leaves the add-on section out.
 */
export default async function PublicPricingPage() {
  const [plansResult, addonsResult] = await Promise.allSettled([fetchPublicPlans(), fetchPublicAddons()]);
  const plans = plansResult.status === "fulfilled" ? plansResult.value : [];
  const addons = addonsResult.status === "fulfilled" ? addonsResult.value : [];
  if (plansResult.status === "rejected") console.error("[pricing] plans unavailable:", plansResult.reason);
  return (
    <div className="min-h-screen bg-[var(--color-page-bg)]">
      <SiteHeader current="pricing" />
      <PricingPage plans={plans} addons={addons} loadError={plansResult.status === "rejected" ? "Pricing is temporarily unavailable. Please try again shortly." : null} />
      <SiteFooter />
    </div>
  );
}
