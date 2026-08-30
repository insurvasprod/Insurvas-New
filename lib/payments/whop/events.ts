// SA-3.1 · The Whop events we subscribe to, and what each one means to us.
//
// Verified against Whop's webhook API reference on 2026-08-30. Client-safe: no imports.

export const WHOP_WEBHOOK_EVENTS = [
  "payment.succeeded",
  "payment.failed",
  "invoice.created",
  "invoice.paid",
  "invoice.past_due",
  "invoice.marked_uncollectible",
  "invoice.voided",
  "membership.activated",
  "membership.deactivated",
  "membership.cancel_at_period_end_changed",
  "refund.created",
  "refund.updated",
  "dispute.created",
  "dispute.updated",
] as const;

export type WhopWebhookEvent = (typeof WHOP_WEBHOOK_EVENTS)[number];

export function isSubscribedEvent(type: string): type is WhopWebhookEvent {
  return (WHOP_WEBHOOK_EVENTS as readonly string[]).includes(type);
}

/**
 * The Standard Webhooks envelope Whop sends.
 *
 * `account_id` replaced `company_id` in the 2026-08-14 API version; webhooks pinned before that
 * date, and unpinned ones, still send `company_id`. Both are accepted so a pin change doesn't
 * break us silently.
 */
export type WhopEnvelope = {
  id: string;
  type: string;
  api_version?: string;
  api_version_date?: string;
  timestamp?: string;
  account_id?: string;
  company_id?: string;
  data?: Record<string, unknown>;
  previous_attributes?: Record<string, unknown>;
};

export function parseEnvelope(raw: string): WhopEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const envelope = parsed as WhopEnvelope;
    if (typeof envelope.type !== "string") return null;
    return envelope;
  } catch {
    return null;
  }
}

/**
 * Best-effort search for a Whop customer identifier we can match against
 * payment_providers.provider_customer_id.
 *
 * Deliberately shape-tolerant: we have not yet seen a real payload for every event type, and a
 * resolver that assumes one shape would fail silently on the others. Unresolved is recorded as
 * null rather than guessed — a webhook attributed to the WRONG tenant is far worse than one
 * attributed to none, because it would change someone else's access.
 *
 * Tighten this once real payloads are in webhook_events.
 */
export function extractCustomerIds(envelope: WhopEnvelope): string[] {
  const found = new Set<string>();
  const CUSTOMER_PREFIXES = ["user_", "mem_", "cus_"];

  function walk(value: unknown, depth: number): void {
    if (depth > 4 || value === null || value === undefined) return;
    if (typeof value === "string") {
      if (CUSTOMER_PREFIXES.some((prefix) => value.startsWith(prefix))) found.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) walk(item, depth + 1);
    }
  }

  walk(envelope.data, 0);
  return [...found];
}
