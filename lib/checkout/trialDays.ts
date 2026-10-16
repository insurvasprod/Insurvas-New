import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { defaultTrialDays } from "@/lib/settings/queries";
import { resolveTrialDays } from "./constants";

/**
 * The trial length for one plan version: plan_prices.trial_days, else the billing.default_trial_days
 * setting, else 14 (resolveTrialDays). Used by checkout completion and by the Whop plan mapping, so
 * the trial Whop sells and the trial our subscription records are the same number.
 */
export async function trialDaysForPlan(planId: string): Promise<number> {
  const { data, error } = await getSupabaseServiceClient()
    .from("plan_prices")
    .select("trial_days")
    .eq("plan_id", planId)
    .maybeSingle<{ trial_days: number | null }>();
  if (error) console.error(`[checkout] could not read plan ${planId}'s trial length; using the default`, error.message);
  const planTrial = data?.trial_days ?? null;
  if (planTrial !== null && resolveTrialDays(planTrial) === planTrial) return planTrial;
  const setting = await defaultTrialDays().catch(() => null);
  return resolveTrialDays(null, setting);
}
