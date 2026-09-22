import type { StatusTone } from "@/components/ui/status-chip";

/**
 * StatusChip now lives in components/ui — it is a shared primitive, not an admin one. Re-exported
 * here so the six tables that import it from this path keep working unchanged.
 */
export { StatusChip, type StatusTone } from "@/components/ui/status-chip";


/**
 * Tone for a subscription status.
 *
 * `past_due` is warning rather than danger deliberately: the customer still has access and a
 * payment may yet land. `suspended` and `cancelled` are the ones where something has actually been
 * taken away.
 */
export function subscriptionTone(status: string | null): StatusTone {
  switch (status) {
    case "active":
      return "good";
    case "trialing":
      return "info";
    case "past_due":
    case "cancelling":
    case "paused":
      return "warning";
    case "suspended":
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * Tone for an invoice status.
 *
 * `void` is neutral, not danger. Voiding is a deliberate act by an operator and the invoice is
 * closed correctly; colouring it red puts it in the same visual bucket as one nobody has paid.
 */
export function invoiceTone(status: string | null): StatusTone {
  switch (status) {
    case "paid":
      return "good";
    case "issued":
      return "info";
    case "draft":
    case "void":
      return "neutral";
    case "overdue":
      return "warning";
    case "uncollectible":
      return "danger";
    default:
      return "neutral";
  }
}

/** Tone for a tenant or user account state. */
export function accountTone(status: string | null): StatusTone {
  switch (status) {
    case "active":
      return "good";
    case "invited":
    case "pending":
      return "info";
    case "suspended":
      return "warning";
    case "deactivated":
    case "inactive":
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * Tone for how an invoice reconciled against what the provider actually charged.
 *
 * `mismatched` is danger and stays danger. It means our records and the money disagree, which is
 * the one thing on an invoice screen that should never be quiet.
 */
export function reconciliationTone(state: string | null): StatusTone {
  switch (state) {
    case "matched":
      return "good";
    case "pending":
      return "info";
    case "mismatched":
      return "danger";
    default:
      return "neutral";
  }
}
