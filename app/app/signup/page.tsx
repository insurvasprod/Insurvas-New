import { redirect } from "next/navigation";

/**
 * One way to sign up: the public flow at /signup (/api/public/signup), which verifies the email,
 * records legal acceptance, refuses disposable addresses and sends the owner to Whop checkout, where
 * the card for the trial is taken. This door used the legacy /api/app/signup, which skipped all of it.
 */
export default function TenantSignupPage(): never {
  redirect("/signup");
}
