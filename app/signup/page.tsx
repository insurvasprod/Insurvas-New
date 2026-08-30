import type { Metadata } from "next";

import { SignupForm } from "@/components/public/signup-form";
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
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <SignupForm initialPlanCode={query.plan} initialCycle={query.cycle} />
      </main>
    </div>
  );
}
