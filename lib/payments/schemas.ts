import { z } from "zod";

import { PROVIDER_CODES, SIMULATED_OUTCOMES } from "./constants";

export const assignProviderSchema = z.object({
  provider: z.enum(PROVIDER_CODES),
  /**
   * Display only — "Visa •••• 4242". Rejected if it looks like a card number, because the one rule
   * this module cannot bend is that no card data reaches our database, dummy provider or not.
   */
  payment_method_label: z
    .string()
    .trim()
    .max(60)
    .optional()
    .refine((value) => !value || !/\d{9,}/.test(value.replace(/[\s-]/g, "")), {
      message: "That looks like a card number. Store a label such as “Visa •••• 4242”, never the number.",
    }),
});

export const simulateSchema = z.object({
  simulate_outcome: z.enum(SIMULATED_OUTCOMES),
});
