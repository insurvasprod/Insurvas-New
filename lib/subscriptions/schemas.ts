import { z } from "zod";

import { BILLING_CYCLES } from "@/lib/money";

export const assignSubscriptionSchema = z.object({
  tenant_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  billing_cycle: z.enum(BILLING_CYCLES),
  start_at: z.string().datetime().optional(),
});

export const changePlanSchema = z.object({
  plan_id: z.string().uuid(),
  /** Upgrade = now, downgrade = period end. The UI defaults this from price and lets it be overridden. */
  apply_now: z.boolean(),
});

export const cancelSubscriptionSchema = z.object({
  // A reason is required: SA-2.7 wants every state change audit-logged with one.
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500),
  immediate: z.boolean().default(false),
});

export const pauseSubscriptionSchema = z.object({
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500),
});
