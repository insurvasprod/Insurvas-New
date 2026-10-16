import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { decryptSensitive, encryptSensitive } from "@/lib/applications/crypto";
import { WEBHOOK_EVENT_KEYS, type WebhookAttemptView, type WebhookEventType, type WebhookStatus, type WebhookView } from "@/lib/apiKeys/constants";
import { checkTargetUrl, generateSigningSecret } from "./rules";

/**
 * LA-8.7 · webhook subscriptions: create, pause, resume, delete, and read the delivery log.
 *
 * The signing secret is shown once, at creation, and stored encrypted (AES-256-GCM under
 * APPLICATION_DATA_ENCRYPTION_KEY, per tenant, bound to the subscription id) — never in a response
 * after that, never in a log. The delivery job opens it to sign.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

const COLUMNS = "id, label, target_url, event_types, status, created_at, last_success_at, last_failure_at, consecutive_failures, disabled_at, disabled_reason";
type Row = { id: string; label: string; target_url: string; event_types: string[]; status: WebhookStatus; created_at: string; last_success_at: string | null; last_failure_at: string | null; consecutive_failures: number; disabled_at: string | null; disabled_reason: string | null };

export class WebhookSchemaPendingError extends Error {
  constructor() {
    super("Webhooks are not available yet: migration 20261015340000 has not been applied.");
    this.name = "WebhookSchemaPendingError";
  }
}
const isMissing = (error: { code?: string; message?: string } | null) => Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || (/webhook_/.test(error.message ?? "") && /does not exist|schema cache/.test(error.message ?? ""))));
const fail = (what: string, error: { code?: string; message: string }) => {
  if (isMissing(error)) return new WebhookSchemaPendingError();
  return new Error(`Could not ${what}: ${error.message}`);
};

/** The secret's encryption scope: the tenant, and the subscription it signs for. */
export const secretScope = (tenantId: string, subscriptionId: string) => ({ tenantId, applicationId: subscriptionId, fieldKey: "webhook_signing_secret" });

export function openSigningSecret(tenantId: string, subscriptionId: string, ciphertext: string, keyVersion: number): string | null {
  return decryptSensitive(ciphertext, keyVersion, secretScope(tenantId, subscriptionId));
}

function view(row: Row, pending: number): WebhookView {
  return {
    id: row.id,
    label: row.label,
    targetUrl: row.target_url,
    eventTypes: row.event_types.filter((event): event is WebhookEventType => (WEBHOOK_EVENT_KEYS as readonly string[]).includes(event)),
    status: row.status,
    createdAt: row.created_at,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    consecutiveFailures: row.consecutive_failures,
    disabledAt: row.disabled_at,
    disabledReason: row.disabled_reason,
    pending,
  };
}

export async function listWebhooks(tenantId: string): Promise<WebhookView[]> {
  const result = await db().from("webhook_subscription").select(COLUMNS).eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(50);
  if (result.error) throw fail("load webhooks", result.error);
  const rows = (result.data ?? []) as Row[];
  if (!rows.length) return [];
  const queued = await db().from("webhook_delivery").select("subscription_id").eq("tenant_id", tenantId).in("status", ["pending", "delivering"]).limit(5000);
  const pending = new Map<string, number>();
  for (const row of (queued.data ?? []) as { subscription_id: string }[]) pending.set(row.subscription_id, (pending.get(row.subscription_id) ?? 0) + 1);
  return rows.map((row) => view(row, pending.get(row.id) ?? 0));
}

export type WebhookInput = { label: string; targetUrl: string; eventTypes: WebhookEventType[] };

/** Returns the secret this once; it is not readable again. */
export async function createWebhook(tenantId: string, userId: string | null, input: WebhookInput): Promise<{ secret: string; record: WebhookView }> {
  const target = checkTargetUrl(input.targetUrl);
  if (!target.ok) throw new Error(target.message);
  const id = crypto.randomUUID();
  const secret = generateSigningSecret();
  const sealed = encryptSensitive(secret, secretScope(tenantId, id));
  const result = await db().from("webhook_subscription").insert({
    id,
    tenant_id: tenantId,
    label: input.label.trim(),
    target_url: target.url.href,
    event_types: [...new Set(input.eventTypes)],
    signing_secret_ciphertext: sealed.ciphertext,
    signing_secret_key_version: sealed.keyVersion,
    created_by: userId,
  }).select(COLUMNS).single();
  if (result.error) throw fail("create the webhook", result.error);
  return { secret, record: view(result.data as Row, 0) };
}

/**
 * Pause or resume. Resuming a failing or disabled subscription starts it clean: the failure count
 * goes to zero and its waiting deliveries are due now.
 */
export async function setWebhookStatus(tenantId: string, id: string, status: "active" | "paused"): Promise<WebhookView> {
  const patch = status === "paused"
    ? { status: "paused", disabled_at: null, disabled_reason: null, updated_at: new Date().toISOString() }
    : { status: "active", consecutive_failures: 0, disabled_at: null, disabled_reason: null, updated_at: new Date().toISOString() };
  const result = await db().from("webhook_subscription").update(patch).eq("tenant_id", tenantId).eq("id", id).select(COLUMNS).maybeSingle();
  if (result.error) throw fail("change the webhook", result.error);
  if (!result.data) throw new Error("That webhook is not yours, or no longer exists.");
  if (status === "active") {
    await db().from("webhook_delivery").update({ next_attempt_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("subscription_id", id).eq("status", "pending");
  }
  return view(result.data as Row, 0);
}

export async function deleteWebhook(tenantId: string, id: string): Promise<void> {
  const result = await db().from("webhook_subscription").delete().eq("tenant_id", tenantId).eq("id", id).select("id");
  if (result.error) throw fail("delete the webhook", result.error);
  if (!result.data?.length) throw new Error("That webhook is not yours, or no longer exists.");
}

/** A `webhook.test` event for one subscription, due now. Returns the delivery id. */
export async function queueTestEvent(tenantId: string, id: string): Promise<string> {
  const sub = await db().from("webhook_subscription").select("id, status").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (sub.error) throw fail("load the webhook", sub.error);
  if (!sub.data) throw new Error("That webhook is not yours, or no longer exists.");
  if (sub.data.status === "paused" || sub.data.status === "disabled") throw new Error("Resume the webhook before sending a test.");
  const eventId = crypto.randomUUID();
  const result = await db().from("webhook_delivery").insert({
    tenant_id: tenantId,
    subscription_id: id,
    event_id: eventId,
    event_type: "webhook.test",
    source_key: `test:${eventId}`,
    payload: { id: eventId, type: "webhook.test", created_at: new Date().toISOString(), data: { message: "A test event from Insurvas. No action is needed." } },
  }).select("id").single();
  if (result.error) throw fail("queue a test event", result.error);
  return (result.data as { id: string }).id;
}

/** The last attempts for one subscription: when, which event, the status code and what came back. */
export async function listAttempts(tenantId: string, id: string, limit = 50): Promise<WebhookAttemptView[]> {
  const result = await db().from("webhook_attempt").select("id, delivery_id, attempt, attempted_at, status_code, ok, duration_ms, response_snippet, error, webhook_delivery!inner(event_type)")
    .eq("tenant_id", tenantId).eq("subscription_id", id).order("attempted_at", { ascending: false }).limit(Math.min(limit, 100));
  if (result.error) throw fail("load the delivery log", result.error);
  return ((result.data ?? []) as Array<{ id: string; delivery_id: string; attempt: number; attempted_at: string; status_code: number | null; ok: boolean; duration_ms: number | null; response_snippet: string | null; error: string | null; webhook_delivery: { event_type: string } | null }>).map((row) => ({
    id: row.id,
    deliveryId: row.delivery_id,
    eventType: row.webhook_delivery?.event_type ?? "",
    attempt: row.attempt,
    attemptedAt: row.attempted_at,
    statusCode: row.status_code,
    ok: row.ok,
    durationMs: row.duration_ms,
    responseSnippet: row.response_snippet,
    error: row.error,
  }));
}
