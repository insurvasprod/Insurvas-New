// LA-3.22 · the carrier portal register: where and as whom the agency signs in, never how. There is
// no password, secret, token, PIN or credential key in any schema here, and every schema is strict,
// so a body that carries one is refused outright (lib/salesSettings/portalRegister.test.mjs).

import { z } from "zod";

import { idSchema } from "./templateSchemas.ts";

/** Any key or column matching this is a secret, and must never exist on the portal register. */
export const PORTAL_SECRET_NAME = /(pass|secret|token|pin|credential)/i;

export const PORTAL_MFA_TYPES = ["app", "sms", "email", "none"] as const;
export const PORTAL_MFA_LABEL: Record<(typeof PORTAL_MFA_TYPES)[number], string> = { app: "App", sms: "SMS", email: "Email", none: "None" };

export const portalAccountSchema = z.object({
  carrier_id: idSchema,
  portal_url: z.string().trim().max(500).regex(/^https:\/\/[^/\s]+/, "Use the portal's https address, like https://agents.carrier.com/login"),
  username: z.string().trim().min(1).max(200).nullable(),
  writing_number: z.string().trim().min(1).max(120).nullable(),
  mfa_type: z.enum(PORTAL_MFA_TYPES),
  notes: z.string().trim().max(2000).nullable().default(null),
  /** The day someone signed in and confirmed it still works (YYYY-MM-DD), or null. */
  last_verified_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date").nullable(),
}).strict();

export type PortalAccountBody = z.infer<typeof portalAccountSchema>;

export const verifyPortalSchema = z.object({}).strict();
