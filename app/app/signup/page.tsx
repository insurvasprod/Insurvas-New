import { redirect } from "next/navigation";

/**
 * One way to sign up: the public flow at /signup (/api/public/signup), which verifies the email,
 * records legal acceptance, refuses disposable addresses and sends the owner to Whop checkout, where
 * the card for the trial is taken. This door used the legacy /api/app/signup, which skipped all of it.
 * The plan and cycle picked on pricing travel with the redirect.
 */
export default async function TenantSignupPage({ searchParams }: { searchParams: Promise<{ plan?: string; cycle?: string }> }): Promise<never> {
  const { plan, cycle } = await searchParams;
  const query = new URLSearchParams();
  if (plan) query.set("plan", plan);
  if (cycle) query.set("cycle", cycle);
  if (query.size) redirect(`/signup?${query}`);
  redirect("/signup");
}
