// LA-3.17 · the tenant's Sales settings: one JSON document in tenant_sales_settings.settings,
// validated here. Client-safe. Every LA-3 feature that reads a setting reads it through
// `resolveSalesSettings`, so a missing or partial row always means the documented defaults.

import { z } from "zod";

export const WELCOME_PACK_LOCKED_TOKENS = ["{statement_descriptor}", "{monthly_amount}", "{draft_day}", "{agent_phone}"] as const;

export const DEFAULT_WELCOME_PACK = {
  subject: "Your {carrier_name} coverage — what to expect",
  body: [
    "Hi {client_first_name},",
    "",
    "Thank you for speaking with me today. Here is what we set up, in plain words.",
    "",
    "Your coverage is with {carrier_name}: {coverage_amount} of {product_name} coverage.",
    "What will appear on your bank statement: {statement_descriptor}",
    "{monthly_amount} will be taken on the {draft_day} of each month.",
    "The money goes to: {beneficiaries}",
    "Your application number: {reference}",
    "",
    "If anything here is wrong, call me first — not your bank.",
    "{agent_name} · {agent_phone} · {agent_email}",
  ].join("\n"),
};

export const salesSettingsSchema = z.object({
  /** LA-3.5 / 3.11 — monthly premium per $1,000 of face; outside it is an amber warning. */
  per1000Band: z.object({ min: z.number().min(0).max(100), max: z.number().min(0).max(100) }).refine((b) => b.min < b.max, "The low end must be below the high end"),
  /** LA-3.11 — a missing appointment warns (default) or blocks `ready`. */
  appointmentBlocks: z.boolean(),
  /** LA-3.9 — days after the latest deposit to aim the draft, 2–4. */
  draftBufferDays: z.number().int().min(2).max(4),
  /** LA-3.18 — a requirement waiting on the client turns amber after N days and red after 2N. */
  requirementAgeingDays: z.number().int().min(1).max(60),
  /** LA-3.20 — send the welcome pack automatically on submit, or draft it for review. */
  welcomePackAutoSend: z.boolean(),
  welcomePack: z.object({ subject: z.string().min(1).max(200), body: z.string().min(1).max(8000) }).refine(
    (t) => WELCOME_PACK_LOCKED_TOKENS.every((token) => t.body.includes(token)),
    { message: "The statement descriptor, monthly amount, draft day and agent phone cannot be removed." },
  ),
  /** LA-3.3 — blocked on decision 4; stored so the switch has a home once a provider is chosen. */
  aiAssistantEnabled: z.boolean(),
}).strict();

export type SalesSettings = z.infer<typeof salesSettingsSchema>;

export const DEFAULT_SALES_SETTINGS: SalesSettings = {
  per1000Band: { min: 0.5, max: 15 },
  appointmentBlocks: false,
  draftBufferDays: 3,
  requirementAgeingDays: 5,
  welcomePackAutoSend: true,
  welcomePack: DEFAULT_WELCOME_PACK,
  aiAssistantEnabled: false,
};

/** Stored JSON → full settings: unknown keys dropped, missing or invalid keys take their default. */
export function resolveSalesSettings(stored: unknown): SalesSettings {
  const raw = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_SALES_SETTINGS) as (keyof SalesSettings)[]) {
    const candidate = { ...DEFAULT_SALES_SETTINGS, [key]: raw[key] };
    out[key] = salesSettingsSchema.safeParse(candidate).success ? raw[key] : DEFAULT_SALES_SETTINGS[key];
  }
  return out as SalesSettings;
}
