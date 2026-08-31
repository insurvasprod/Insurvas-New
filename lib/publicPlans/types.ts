import type { BillingCycle } from "@/lib/money";

export type PublicPlan = {
  code: string;
  name: string;
  price_monthly: string | null;
  price_quarterly: string | null;
  price_yearly: string | null;
  blurb: string | null;
  feature_bullets: string[];
  trial_days: number;
  is_default: boolean;
};

export function publicPriceForCycle(plan: PublicPlan, cycle: BillingCycle): string | null {
  if (cycle === "monthly") return plan.price_monthly;
  if (cycle === "quarterly") return plan.price_quarterly;
  return plan.price_yearly;
}
