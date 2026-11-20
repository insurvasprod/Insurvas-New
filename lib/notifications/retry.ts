/**
 * Whether a notification email that did not go out should be handed back for a later run.
 *
 * The outbox claims a row before sending it (so two runs never email it twice). Before 2026-11-19 a
 * failed send kept that claim, so every alert sent while Gmail refused the login (6–19 Nov) was
 * used up and lost. Now a send that failed for a reason that can clear on its own is released:
 *
 *   provider_rejected      the mail server refused (bad login, outage, rate limit) — retry.
 *   email_not_configured   SMTP settings missing on this deployment — retry once they are set.
 *
 * Skips that are decisions, not faults, stay handled: delivery switched off on purpose
 * (email_delivery_disabled) and demo/test addresses (reserved_test_recipient) would never succeed.
 * Retries stop by themselves: the outbox only picks up rows from the last two days.
 */
export type SendResult = { delivered: true } | { delivered: false; reason: string };

const RETRYABLE = new Set(["provider_rejected", "email_not_configured"]);

export function shouldRetrySend(result: SendResult): boolean {
  return !result.delivered && RETRYABLE.has(result.reason);
}
