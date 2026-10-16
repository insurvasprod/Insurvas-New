import { z } from "zod";

import { BILLING_CYCLES } from "@/lib/money";

// SA-2.7 wants every state change audit-logged with a reason — assign, change, cancel, pause and
// resume alike — so every admin subscription action takes the same reason field.
const reasonField = z.string().trim().min(5, "Give a reason of at least 5 characters").max(500);

export const assignSubscriptionSchema = z.object({
  tenant_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  billing_cycle: z.enum(BILLING_CYCLES),
  start_at: z.string().datetime().optional(),
  reason: reasonField,
});

export const changePlanSchema = z.object({
  plan_id: z.string().uuid(),
  /**
   * A request, not an order. The database decides from the two prices on the subscription's cycle:
   * a downgrade always waits for the period end, whatever this says; an upgrade or a same-price move
   * applies now unless this is false (queue it instead).
   */
  apply_now: z.boolean().default(true),
  reason: reasonField,
});

export const cancelSubscriptionSchema = z.object({
  reason: reasonField,
  immediate: z.boolean().default(false),
});

export const pauseSubscriptionSchema = z.object({
  reason: reasonField,
});

/** Resume restores access, so it is recorded with a reason like the pause it undoes. */
export const resumeSubscriptionSchema = z.object({
  reason: reasonField,
});
