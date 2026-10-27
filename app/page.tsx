import type { Metadata } from "next";

import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";
import { LandingHero } from "@/components/marketing/landing-hero";
import { LandingIntro } from "@/components/marketing/landing-intro";
import { LandingExploded } from "@/components/marketing/landing-exploded";
import { LandingBento } from "@/components/marketing/landing-bento";
import { LandingCta, LandingFaq, LandingPricingTeaser, LandingTruths } from "@/components/marketing/landing-sections";
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
    <div className="type-brand min-h-screen bg-background">
      {/* First visit of a session: the mark is drawn out of the hero's lines, then the page opens. */}
      <LandingIntro />
      <SiteHeader current="home" floating />
      <main>
        {/* The story (2026-10-13, after the research pass): the promise, light and editorial, with a
            living WebGL ribbon → who it is for → inside one call (the product comes apart in 3D) →
            what it does (tiles with live 3D objects) → price → questions → the close. */}
        <LandingHero />
        <LandingTruths />
        <LandingExploded />
        <LandingBento />
        <LandingPricingTeaser plans={plans} />
        <LandingFaq />
        <LandingCta />
      </main>
      <SiteFooter />
    </div>
  );
}
