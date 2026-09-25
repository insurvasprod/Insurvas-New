import { redirect } from "next/navigation";

import { AuthPage } from "@/components/app/auth-card";
import { BusinessProfileForm } from "@/components/app/business-profile-form";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";

export default async function BusinessProfilePage() {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");
  const destination = signupDestination(context);
  if (destination && destination !== "/app/onboarding/business-profile") redirect(destination);
  return <AuthPage><BusinessProfileForm /></AuthPage>;
}
