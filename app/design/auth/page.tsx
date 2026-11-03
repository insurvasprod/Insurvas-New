import { notFound } from "next/navigation";

import { AuthShowcase } from "@/components/design/auth-showcase";
import { fetchPlanChoices } from "@/lib/signup/planChoiceQueries";

export const metadata = { title: "Auth layout · Insurvas design system" };

/** Every combination of the one auth layout (UI-CONSISTENCY.md §13). Development only. */
export default async function AuthLayoutPage() {
  if (process.env.NODE_ENV === "production") notFound();
  // The published plans, so step 4 is checked with the real cards and prices. Without a database the
  // step 4 variant says so instead.
  const planChoices = await fetchPlanChoices().catch(() => null);
  return <AuthShowcase planChoices={planChoices} />;
}
