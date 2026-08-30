import { redirect } from "next/navigation";

import { BusinessProfileForm } from "@/components/app/business-profile-form";
import { OnboardingFrame } from "@/components/public/onboarding-frame";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";

export default async function BusinessProfilePage() {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");
  const destination = signupDestination(context);
  if (destination && destination !== "/app/onboarding/business-profile") redirect(destination);
  return <OnboardingFrame><BusinessProfileForm /></OnboardingFrame>;
}
