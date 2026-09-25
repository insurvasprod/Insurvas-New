import type { Metadata } from "next";

import { SignupForm } from "@/components/public/signup-form";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";

export const metadata: Metadata = {
  title: "Create account · Insurvas",
  description: "Create your Insurvas account and workspace.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; cycle?: string }>;
}) {
  const query = await searchParams;
  return (
    <div className="min-h-screen bg-[var(--color-page-bg)]">
      <SiteHeader />
      <main className="m-in mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-16">
        <SignupForm initialPlanCode={query.plan} initialCycle={query.cycle} />
      </main>
      <SiteFooter />
    </div>
  );
}
