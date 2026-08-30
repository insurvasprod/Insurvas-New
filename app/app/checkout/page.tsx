import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, CreditCard, ListChecks } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OnboardingFrame } from "@/components/public/onboarding-frame";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export default async function CheckoutHandoffPage() {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");
  if (context.userStatus !== "active") redirect("/app/login");
  const destination = signupDestination(context);
  if (destination && destination !== "/app/checkout") redirect(destination);

  const supabase = getSupabaseServiceClient();
  const [{ data: selection }, { data: profile }] = await Promise.all([
    supabase.from("signup_selections").select("plan_id, billing_cycle").eq("tenant_id", context.tenantId).maybeSingle(),
    supabase.from("business_profiles").select("business_name, recommended_setup_steps").eq("tenant_id", context.tenantId).maybeSingle(),
  ]);
  const { data: plan } = selection
    ? await supabase.from("plans").select("name").eq("id", selection.plan_id).maybeSingle()
    : { data: null };

  return (
    <OnboardingFrame>
      <Card className="bg-white shadow-[0_18px_50px_rgba(0,64,127,0.12)]">
        <CardHeader className="items-center text-center">
          <span className="mb-2 flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-[var(--color-success)]"><Check className="size-7" /></span>
          <CardTitle className="text-3xl font-extrabold">Your workspace is ready</CardTitle>
          <p className="text-sm text-[var(--color-text-muted)]">{profile?.business_name ?? "Your business"} is ready to continue to secure checkout.</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border bg-[var(--color-row-bg)] p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Selected plan</p>
              <p className="mt-2 text-lg font-extrabold">{plan?.name ?? "Selected plan"}</p>
              <p className="text-sm capitalize text-[var(--color-text-muted)]">{selection?.billing_cycle ?? "Billing cycle pending"}</p>
            </div>
            <div className="rounded-xl border bg-[var(--color-row-bg)] p-5">
              <div className="flex items-center gap-2"><ListChecks className="size-4 text-[var(--brand-600)]" /><p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Personalized setup</p></div>
              <p className="mt-2 text-sm">{profile?.recommended_setup_steps?.length ?? 0} guided steps prepared from your profile.</p>
            </div>
          </div>

          {(profile?.recommended_setup_steps?.length ?? 0) > 0 && (
            <div className="rounded-xl border p-5">
              <h2 className="font-extrabold">After checkout, we’ll guide you through</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {profile!.recommended_setup_steps.map((step) => <li key={step} className="flex gap-2"><Check className="mt-0.5 size-4 text-[var(--color-success)]" />{step}</li>)}
              </ul>
            </div>
          )}

          <Button size="lg" className="w-full" disabled>
            <CreditCard /> Continue to secure checkout · SA-5.2
          </Button>
          <p className="text-center text-xs text-[var(--color-text-muted)]">Hosted Whop checkout and trial activation are deliberately connected in SA-5.2.</p>
          <div className="text-center"><Button asChild variant="link"><Link href="/pricing">Change selected plan</Link></Button></div>
        </CardContent>
      </Card>
    </OnboardingFrame>
  );
}
