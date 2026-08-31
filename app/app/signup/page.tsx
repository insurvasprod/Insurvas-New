import Link from "next/link";
import { Building2 } from "lucide-react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TenantSignupForm } from "@/components/app/tenant-signup-form";
import { fetchPublicPlans } from "@/lib/plans/public";

export const dynamic = "force-dynamic";

export default async function TenantSignupPage() {
  const plans = await fetchPublicPlans();

  return (
    <main className="min-h-screen bg-[var(--color-page-bg)] px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <Card className="mb-6">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-[var(--color-blue-faint)] text-[var(--color-blue)]"><Building2 className="size-5" /></div>
            <CardTitle className="text-2xl">Create your Insurvas workspace</CardTitle>
            <CardDescription>Choose the subscription that fits your business and start with a configured tenant workspace.</CardDescription>
          </CardHeader>
        </Card>
        <TenantSignupForm plans={plans} />
        <p className="mt-6 text-center text-sm text-muted-foreground">Already have an account? <Link className="font-medium text-[var(--color-blue)] hover:underline" href="/app/login">Sign in</Link></p>
      </div>
    </main>
  );
}
