import type { Metadata } from "next";

import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";
import { LandingHero } from "@/components/marketing/landing-hero";
import { LandingBento } from "@/components/marketing/landing-bento";
import { LandingAudience, LandingBuiltFor } from "@/components/marketing/landing-audience";
import { LandingPricingTeaser } from "@/components/marketing/landing-pricing";
import { LandingFaq } from "@/components/marketing/landing-faq";
import { fetchPublicPlans } from "@/lib/publicPlans/queries";
import type { PublicPlan } from "@/lib/publicPlans/types";

export const metadata: Metadata = {
  title: "Insurvas · Know what every lead cost you",
  description:
    "The inbound floor, the outbound dialer, applications and the book of business in one workspace — with every issued policy traced back to the campaign that paid for it.",
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
    <div className="type-brand landing-type min-h-screen bg-background">
      <SiteHeader current="home" floating />
      <main>
        {/* The story (2026-11-03 redesign, docs/design/landing-page-redesign-spec.md): the promise over
            the product itself → who it is for → the answer (True CPA) → the workspace, feature by
            feature → price → questions. The closing "Try it free" band was dropped on the owner's
            instruction (3 Nov); the header's trial button rides the whole page, so the page is never
            without a call to action. */}
        <LandingHero />
        <LandingBuiltFor />
        <LandingAudience />
        <LandingBento />
        <LandingPricingTeaser plans={plans} />
        <LandingFaq />
      </main>
      <SiteFooter />
    </div>
  );
}
