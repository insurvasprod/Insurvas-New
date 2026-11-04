import type { Metadata } from "next";

import { RoadmapPage } from "@/components/marketing/roadmap-page";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";

export const metadata: Metadata = {
  title: "Roadmap · Insurvas",
  description: "What Insurvas has shipped, what we are building, and what we are exploring. Quarters, not promises.",
};

export default function PublicRoadmapPage() {
  return (
    <div className="type-brand landing-type min-h-screen bg-[var(--color-page-bg)]">
      <SiteHeader floating />
      <RoadmapPage />
      <SiteFooter />
    </div>
  );
}
