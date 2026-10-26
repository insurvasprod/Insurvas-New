import type { Metadata } from "next";

import { FunnelFrame } from "@/components/app/funnel-frame";
import { SignupForm } from "@/components/public/signup-form";
import { checkoutPaymentMode } from "@/lib/checkout/paymentMode";

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
    <FunnelFrame step={1}>
      <SignupForm initialPlanCode={query.plan} initialCycle={query.cycle} noPayment={checkoutPaymentMode() === "none"} />
    </FunnelFrame>
  );
}
