import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { encryptSensitive } from "@/lib/applications/crypto";
import { deliverDueWebhooks } from "@/lib/webhooks/deliver";
import { MAX_ATTEMPTS, checkTargetUrl, generateSigningSecret } from "@/lib/webhooks/rules";
import { WebhookSchemaPendingError, listWebhooks, secretScope, setWebhookStatus } from "@/lib/webhooks/service";
import type { WebhookEventType, WebhookView } from "./constants";
import type { DeliveryLogRow, HookExtras } from "./hub";

/**
 * Settings › Integrations, round 8: what the webhook table, its status line and the webhook's sheet
 * read beyond the subscription itself (next try, missed events, their last answer, the delivery log
 * with what we sent), and "Retry now". All on the LA-8.7 tables as they are — no new columns.
 *
 * A retry never invents an event: it brings an existing delivery forward (waiting) or puts one that
 * gave up back in the queue (missed), and the delivery job sends it, signed, as it sends any other.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

const isMissing = (error: { code?: string; message?: string } | null) => Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || (/webhook_/.test(error.message ?? "") && /does not exist|schema cache/.test(error.message ?? ""))));
const fail = (what: string, error: { code?: string; message: string }) => (isMissing(error) ? new WebhookSchemaPendingError() : new Error(`Could not ${what}: ${error.message}`));

/** The most attempts a delivery may log (the table's check). A retry by hand stops there. */
const ATTEMPT_CEILING = 20;

type HookRow = { id: string; status: string; lastSuccessAt: string | null; createdAt: string };

/** One read per table for every webhook on the page. Never throws: the list stands without these. */
export async function webhookExtras(tenantId: string, hooks: HookRow[]): Promise<Record<string, HookExtras>> {
  const out: Record<string, HookExtras> = {};
  if (!hooks.length) return out;
  for (const hook of hooks) out[hook.id] = { nextTryAt: null, missed: 0, lastAnswer: null };
  const ids = hooks.map((hook) => hook.id);
  const troubled = hooks.filter((hook) => hook.status === "failing" || hook.status === "disabled" || hook.status === "active").map((hook) => hook.id);
  try {
    const [waiting, gaveUp, answers] = await Promise.all([
      db().from("webhook_delivery").select("subscription_id, next_attempt_at").eq("tenant_id", tenantId).in("subscription_id", ids).in("status", ["pending", "delivering"]).order("next_attempt_at", { ascending: true }).limit(2000),
      db().from("webhook_delivery").select("subscription_id, finished_at").eq("tenant_id", tenantId).in("subscription_id", ids).in("status", ["failed", "cancelled"]).neq("event_type", "webhook.test").limit(5000),
      troubled.length
        ? db().from("webhook_attempt").select("subscription_id, status_code, error, attempted_at").eq("tenant_id", tenantId).in("subscription_id", troubled).eq("ok", false).order("attempted_at", { ascending: false }).limit(200)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const row of (waiting.data ?? []) as { subscription_id: string; next_attempt_at: string }[]) {
      const extra = out[row.subscription_id];
      if (extra && !extra.nextTryAt) extra.nextTryAt = row.next_attempt_at;
    }
    const since = new Map(hooks.map((hook) => [hook.id, hook.lastSuccessAt ?? hook.createdAt]));
    for (const row of (gaveUp.data ?? []) as { subscription_id: string; finished_at: string | null }[]) {
      const extra = out[row.subscription_id];
      if (extra && row.finished_at && row.finished_at > (since.get(row.subscription_id) ?? "")) extra.missed += 1;
    }
    for (const row of (answers.data ?? []) as { subscription_id: string; status_code: number | null; error: string | null; attempted_at: string }[]) {
      const extra = out[row.subscription_id];
      if (extra && !extra.lastAnswer) extra.lastAnswer = { statusCode: row.status_code, error: row.error, at: row.attempted_at };
    }
  } catch (error) {
    console.error("[webhooks] extras failed", error instanceof Error ? error.message : error);
  }
  return out;
}

type LogDb = {
  id: string; delivery_id: string; attempt: number; attempted_at: string; status_code: number | null; ok: boolean; duration_ms: number | null; response_snippet: string | null; error: string | null;
  webhook_delivery: { event_type: string; status?: string; attempts?: number; next_attempt_at?: string; policy?: string | null; carrier?: string | null; premium?: string | null; mode?: string | null; product?: string | null; difference?: string | null } | null;
};

const LOG_BASE = "id, delivery_id, attempt, attempted_at, status_code, ok, duration_ms, response_snippet, error";
// A few named fields of the payload, never the body: a form's answers stay in the database.
const LOG_FACTS = "event_type, status, attempts, next_attempt_at, policy:payload->data->>policy_number, carrier:payload->data->carrier->>name, premium:payload->data->>premium_cents, mode:payload->data->>premium_mode, product:payload->data->>product, difference:payload->data->>difference_cents";

/** The last attempts for one webhook, newest first, with their delivery's state and what was sent. */
export async function deliveryLog(tenantId: string, subscriptionId: string, limit = 50): Promise<{ rows: DeliveryLogRow[]; maxAttempts: number }> {
  const query = (embed: string) => db().from("webhook_attempt").select(`${LOG_BASE}, webhook_delivery!inner(${embed})`)
    .eq("tenant_id", tenantId).eq("subscription_id", subscriptionId).order("attempted_at", { ascending: false }).limit(Math.min(limit, 100));
  let result = await query(LOG_FACTS);
  // The payload paths are a nicety: when they cannot be read, the log still shows every attempt.
  if (result.error && !isMissing(result.error)) result = await query("event_type, status, attempts, next_attempt_at");
  if (result.error) throw fail("load the deliveries", result.error);
  const rows = ((result.data ?? []) as LogDb[]).map((row) => ({
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
    deliveryStatus: row.webhook_delivery?.status ?? null,
    nextAttemptAt: row.webhook_delivery?.status === "pending" ? row.webhook_delivery?.next_attempt_at ?? null : null,
    deliveryAttempts: row.webhook_delivery?.attempts ?? null,
    facts: {
      policyNumber: row.webhook_delivery?.policy ?? null,
      carrier: row.webhook_delivery?.carrier ?? null,
      premiumCents: row.webhook_delivery?.premium ?? null,
      premiumMode: row.webhook_delivery?.mode ?? null,
      product: row.webhook_delivery?.product ?? null,
      differenceCents: row.webhook_delivery?.difference ?? null,
    },
  }));
  return { rows, maxAttempts: MAX_ATTEMPTS };
}

/**
 * The webhook sheet's Setup: its name, address and events. The address passes the same check as at
 * creation (HTTPS, public, the standard port); the delivery job checks it again after DNS.
 */
export async function updateWebhook(tenantId: string, id: string, input: { label?: string; targetUrl?: string; eventTypes?: WebhookEventType[] }): Promise<{ before: WebhookView; record: WebhookView }> {
  const before = (await listWebhooks(tenantId)).find((hook) => hook.id === id);
  if (!before) throw new Error("That webhook is not yours, or no longer exists.");
  const patch: Record<string, unknown> = {};
  if (input.label !== undefined) {
    const label = input.label.trim();
    if (!label || label.length > 80) throw new Error("Name the webhook, in up to 80 characters.");
    if (label !== before.label) patch.label = label;
  }
  if (input.targetUrl !== undefined) {
    const target = checkTargetUrl(input.targetUrl);
    if (!target.ok) throw new Error(target.message);
    if (target.url.href !== before.targetUrl) patch.target_url = target.url.href;
  }
  if (input.eventTypes !== undefined) {
    const events = [...new Set(input.eventTypes)];
    if (!events.length) throw new Error("Choose at least one event.");
    if (events.slice().sort().join() !== before.eventTypes.slice().sort().join()) patch.event_types = events;
  }
  if (!Object.keys(patch).length) return { before, record: before };
  patch.updated_at = new Date().toISOString();
  const result = await db().from("webhook_subscription").update(patch).eq("tenant_id", tenantId).eq("id", id).select("id").maybeSingle();
  if (result.error) {
    if (/webhook_subscription_events/.test(result.error.message ?? "")) throw new Error("Application form events need a database update first. Pick the other events for now.");
    throw fail("save the webhook", result.error);
  }
  if (!result.data) throw new Error("That webhook is not yours, or no longer exists.");
  const record = (await listWebhooks(tenantId)).find((hook) => hook.id === id) ?? before;
  return { before, record };
}

/**
 * "Make a new secret": a new signing secret, shown once, sealed as at creation. From the next
 * delivery on, signatures use it; the receiver must swap it in, so the sheet says so before asking.
 */
export async function newSigningSecret(tenantId: string, id: string): Promise<{ secret: string; label: string }> {
  const sub = await subscription(tenantId, id);
  const secret = generateSigningSecret();
  const sealed = encryptSensitive(secret, secretScope(tenantId, id));
  const result = await db().from("webhook_subscription").update({ signing_secret_ciphertext: sealed.ciphertext, signing_secret_key_version: sealed.keyVersion, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", id).select("id").maybeSingle();
  if (result.error) throw fail("make a new secret", result.error);
  if (!result.data) throw new Error("That webhook is not yours, or no longer exists.");
  return { secret, label: sub.label };
}

export type RetryMode = "waiting" | "missed" | "delivery";

async function subscription(tenantId: string, id: string): Promise<{ id: string; status: string; disabled_at: string | null; last_success_at: string | null; created_at: string; label: string }> {
  const read = await db().from("webhook_subscription").select("id, status, disabled_at, last_success_at, created_at, label").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (read.error) throw fail("load the webhook", read.error);
  if (!read.data) throw new Error("That webhook is not yours, or no longer exists.");
  return read.data;
}

/** Puts given-up deliveries back in the queue, oldest first (their own time, so they go in order). */
async function requeue(tenantId: string, rows: { id: string; created_at: string }[]): Promise<number> {
  let queued = 0;
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    const results = await Promise.all(batch.map((row) => db().from("webhook_delivery")
      .update({ status: "pending", finished_at: null, lease_until: null, next_attempt_at: row.created_at })
      .eq("tenant_id", tenantId).eq("id", row.id).in("status", ["failed", "cancelled"]).lt("attempts", ATTEMPT_CEILING).select("id")));
    for (const result of results) {
      if (result.error) throw fail("put the delivery back in the queue", result.error);
      queued += (result.data ?? []).length;
    }
  }
  return queued;
}

/**
 * "Retry now". waiting: the webhook's waiting deliveries are due now. missed: a turned-off or failing
 * webhook is turned on and the events it gave up on since it last worked go again, in order (at most
 * 200). delivery: one delivery from the log goes again. Then this agency's due deliveries are sent
 * at once, so the answer is on screen without waiting for the job.
 */
export async function retryWebhook(tenantId: string, id: string, mode: RetryMode, deliveryId?: string): Promise<{ queued: number; turnedOn: boolean; sent: { claimed: number; succeeded: number; retry: number; failed: number } }> {
  const sub = await subscription(tenantId, id);
  let queued = 0;
  let turnedOn = false;
  const now = new Date().toISOString();

  if (mode === "missed") {
    const since = sub.status === "disabled" && sub.disabled_at
      ? new Date(Date.parse(sub.disabled_at) - 60_000).toISOString()
      : sub.last_success_at ?? sub.created_at;
    if (sub.status !== "active" && sub.status !== "failing") {
      await setWebhookStatus(tenantId, id, "active");
      turnedOn = true;
    }
    const missed = await db().from("webhook_delivery").select("id, created_at, finished_at").eq("tenant_id", tenantId).eq("subscription_id", id)
      .in("status", ["failed", "cancelled"]).neq("event_type", "webhook.test").lt("attempts", ATTEMPT_CEILING).gt("finished_at", since)
      .order("created_at", { ascending: true }).limit(200);
    if (missed.error) throw fail("find the missed events", missed.error);
    queued = await requeue(tenantId, (missed.data ?? []) as { id: string; created_at: string }[]);
  } else {
    if (sub.status === "paused") throw new Error("This webhook is paused. Resume it to send again.");
    if (sub.status === "disabled") throw new Error("This webhook is turned off. Turn it on to send again.");
    if (mode === "waiting") {
      const due = await db().from("webhook_delivery").update({ next_attempt_at: now }).eq("tenant_id", tenantId).eq("subscription_id", id).eq("status", "pending").select("id");
      if (due.error) throw fail("bring the waiting events forward", due.error);
      queued = (due.data ?? []).length;
    } else {
      if (!deliveryId || !/^[0-9a-f-]{36}$/i.test(deliveryId)) throw new Error("Pick a delivery to retry.");
      const one = await db().from("webhook_delivery").select("id, status, created_at, attempts").eq("tenant_id", tenantId).eq("subscription_id", id).eq("id", deliveryId).maybeSingle();
      if (one.error) throw fail("load the delivery", one.error);
      if (!one.data) throw new Error("That delivery is no longer in the log.");
      if (one.data.status === "succeeded") throw new Error("That one was delivered. Nothing to retry.");
      if (one.data.attempts >= ATTEMPT_CEILING) throw new Error(`That one has been tried ${ATTEMPT_CEILING} times. Fix their server, then send a test.`);
      if (one.data.status === "pending" || one.data.status === "delivering") {
        const due = await db().from("webhook_delivery").update({ next_attempt_at: now }).eq("tenant_id", tenantId).eq("id", deliveryId).eq("status", "pending").select("id");
        if (due.error) throw fail("bring the delivery forward", due.error);
        queued = (due.data ?? []).length;
      } else {
        queued = await requeue(tenantId, [{ id: one.data.id, created_at: now }]);
      }
    }
  }
  const sent = await deliverDueWebhooks({ tenantId, limit: 50 });
  return { queued, turnedOn, sent };
}
