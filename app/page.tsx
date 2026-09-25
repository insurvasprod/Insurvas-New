import type { Metadata } from "next";

import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";
import { LandingHero } from "@/components/marketing/landing-hero";
import { LandingTour } from "@/components/marketing/landing-tour";
import { LandingJourney } from "@/components/marketing/landing-journey";
import { LandingCompliance, LandingCta, LandingFaq, LandingJobs, LandingPricingTeaser, LandingProblem, LandingTruths } from "@/components/marketing/landing-sections";
import { fetchPublicPlans } from "@/lib/publicPlans/queries";
import type { PublicPlan } from "@/lib/publicPlans/types";

export const metadata: Metadata = {
  title: "Insurvas · Know what every lead cost you",
  description:
    "The inbound floor, the outbound dialer and the book of business in one workspace — with every issued policy traced back to the campaign that paid for it.",
};

/**
 * The landing page. `/` used to redirect to /pricing; the p-pub-root board called making it a real
 * page "the proposal" (p-mkt-home), and the owner asked for a standout presentation of the whole
 * product. Pricing stays the front door for plans; this is the front door for the product.
 *
 * The one server read is the plan catalog for the pricing teaser, and it is allowed to fail: a
 * marketing page must never 500 because a price query did.
 */
export default async function Home() {
  const plans: PublicPlan[] = await fetchPublicPlans().catch(() => []);
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader current="home" />
      <main>
        <LandingHero />
        <LandingTruths />
        <LandingTour />
        <LandingProblem />
        <LandingJobs />
        <LandingJourney />
        <LandingCompliance />
        <LandingPricingTeaser plans={plans} />
        <LandingFaq />
        <LandingCta />
      </main>
      <SiteFooter />
    </div>
  );
}
