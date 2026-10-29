import { redirect } from "next/navigation";
import Link from "next/link";

import { FunnelFrame, FunnelHeading } from "@/components/app/funnel-frame";
import { Button } from "@/components/ui/button";
import { resolveSignupContext } from "@/lib/signup/context";

export default async function OnboardingCompletePage() {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");
  if (context.userStatus !== "active" || context.onboardingState !== "completed") redirect("/app/dashboard");
  return (
    <FunnelFrame step={4}>
      <FunnelHeading title="Your workspace is ready">You can add business details later from Settings whenever you need them.</FunnelHeading>
      <Button asChild className="h-12 w-full"><Link href="/app/dashboard">Continue to your workspace</Link></Button>
    </FunnelFrame>
  );
}
