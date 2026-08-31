import "server-only";

// The app's entry point into the period billing run.
//
// A thin wrapper on purpose. Everything the run actually does lives in ./gather.ts, which takes its
// database client as an argument so that scripts/run-period-billing.mjs can execute the identical
// code path — `server-only` throws outside a request, and a billing rule that only the web app can
// reach is a billing rule the scheduled job will eventually disagree with.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { runPeriodBilling as run, billSubscriptionPeriod as billOne, findDueSubscriptions as findDue } from "./gather";
import type { DueSubscription, PeriodBillingOutcome } from "./gather";

export type { DueSubscription, PeriodBillingOutcome };

export function findDueSubscriptions(now?: Date): Promise<DueSubscription[]> {
  return findDue(getSupabaseServiceClient(), now);
}

export function billSubscriptionPeriod(
  subscription: DueSubscription,
  options?: { createdBy?: string | null },
): Promise<PeriodBillingOutcome> {
  return billOne(getSupabaseServiceClient(), subscription, options);
}

export function runPeriodBilling(options?: { now?: Date; createdBy?: string | null }): Promise<PeriodBillingOutcome[]> {
  return run(getSupabaseServiceClient(), options);
}
