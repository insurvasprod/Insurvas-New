import type { Metadata } from "next";

import { PricingPage } from "@/components/public/pricing-page";
import { SiteHeader } from "@/components/public/site-header";

export const metadata: Metadata = {
  title: "Pricing · Insurvas",
  description: "Choose an Insurvas plan and start your trial.",
};

export default function PublicPricingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-page-bg)]">
      <SiteHeader />
      <PricingPage />
    </div>
  );
}
