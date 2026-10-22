// Create tenant (doc 2 §5.3): the billing choices and their wording. Plain module, no `server-only`,
// so the dialog, the route and the tests share it.

export const TENANT_BILLING_CHOICES = ["card", "manual", "comped"] as const;
export type TenantBillingChoice = (typeof TENANT_BILLING_CHOICES)[number];

export const TENANT_BILLING_LABELS: Record<TenantBillingChoice, string> = {
  card: "Card — they pay at checkout",
  manual: "Manual invoice — bank transfer",
  comped: "Comped — no charge",
};

/** The same ceiling as extending a trial (POST /api/admin/trials/:id) and the database check. */
export const TRIAL_DAYS_MAX = 90;

/** The tenants.billing_mode each choice records. Comped is manual (no automatic charge) + a comp row. */
export function billingModeFor(choice: TenantBillingChoice): "automatic" | "manual" {
  return choice === "card" ? "automatic" : "manual";
}
