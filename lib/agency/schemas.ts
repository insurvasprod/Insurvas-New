import { z } from "zod";

/**
 * AG-0.1 · the ordinary producer-update API. `.strict()` is the point: `canSubmit` (or any field the
 * schema does not name) is REFUSED, not silently dropped, so a client cannot even attempt to set it.
 * can_submit is derived by the licence gate (AG-1.10 / LA-6.2) and has no grant for any application role.
 */
export const producerProfileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    npn: z
      .string()
      .trim()
      .regex(/^[0-9]{1,10}$/, "An NPN is up to 10 digits")
      .nullable()
      .optional(),
    hiredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-18").nullable().optional(),
  })
  .strict();

export type ProducerProfileUpdate = z.infer<typeof producerProfileUpdateSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-18");

/** AG-0.9 · a producer's level and/or writing number for one carrier, from a date. Level as a percentage string. */
export const producerCarrierSchema = z
  .object({
    carrierId: z.string().uuid("Choose a carrier"),
    levelPercent: z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter the level as a percentage, like 90 or 85.5").nullable().optional(),
    writingNumber: z.string().trim().min(1).max(120).nullable().optional(),
    effectiveFrom: isoDate,
  })
  .strict()
  .refine((v) => Boolean(v.levelPercent) || Boolean(v.writingNumber), { message: "Enter a level, a writing number, or both" });

/** AG-0.9 · one appointment for a producer, carrier and state. */
export const producerAppointmentSchema = z
  .object({
    carrierId: z.string().uuid("Choose a carrier"),
    state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Choose a state"),
    status: z.enum(["pending", "appointed", "terminated"]),
    effectiveFrom: isoDate.nullable().optional(),
    expiresOn: isoDate.nullable().optional(),
  })
  .strict();

/** AG-0.3 · move a producer to a manager (null = the owner) from a date. */
export const moveProducerSchema = z
  .object({ managerProducerId: z.string().uuid().nullable(), effectiveFrom: isoDate })
  .strict();
