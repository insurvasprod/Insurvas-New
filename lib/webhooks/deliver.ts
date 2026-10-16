import "server-only";

import { lookup } from "node:dns";
import { request as httpsRequest } from "node:https";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { notifyTenantAgents } from "@/lib/agentAlerts/service";
import { checkTargetUrl, isPrivateAddress, isSuccessStatus, nextForDelivery, nextForSubscription, responseSnippet, signPayload } from "./rules";
import { openSigningSecret } from "./service";

/**
 * LA-8.7 · the delivery job (run by /api/cron/webhooks; "Send test" runs it for one agency at once).
 *
 * Claim due deliveries (leased, so two runs never send one twice), sign each body with its
 * subscription's secret, POST it, log the attempt with its status code and a snippet of the reply,
 * and decide what happens next: done, retry later on the ladder, or give up. A subscription whose
 * deliveries keep failing goes `failing`, then `disabled` — and its agency's owners are told. A
 * webhook that quietly stopped working is worse than one that never existed.
 *
 * The connection goes to the address that was checked: the request's DNS lookup is the check, so a
 * name that resolves to a private address — at save time or later — is refused, and cannot be
 * swapped between the check and the connect.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

const TIMEOUT_MS = 10_000;

type Delivery = { id: string; tenant_id: string; subscription_id: string; event_id: string; event_type: string; payload: unknown; attempts: number };
type Subscription = { id: string; tenant_id: string; label: string; target_url: string; status: "active" | "paused" | "failing" | "disabled"; consecutive_failures: number; signing_secret_ciphertext: string; signing_secret_key_version: number };

type PostResult = { status: number | null; body: string; error: string | null; durationMs: number };

/** POST over HTTPS to a public address only; no redirects followed. */
function post(target: URL, body: string, headers: Record<string, string>): Promise<PostResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const req = httpsRequest(target, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body).toString(), "user-agent": "Insurvas-Webhooks/1", ...headers },
      timeout: TIMEOUT_MS,
      lookup: (hostname, options, callback) => {
        lookup(hostname, { all: true }, (error, addresses) => {
          if (error) return callback(error, "", 4);
          const list = addresses as { address: string; family: number }[];
          if (!list.length || list.some((entry) => isPrivateAddress(entry.address))) {
            return callback(Object.assign(new Error("The webhook host resolves to a private address."), { code: "EPRIVATE" }), "", 4);
          }
          // Node asks for one address unless `all` was requested of it.
          if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
          callback(null, list[0].address, list[0].family);
        });
      },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { if (text.length < 4000) text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? null, body: text, error: null, durationMs: Date.now() - started }));
    });
    req.on("timeout", () => req.destroy(new Error(`No answer within ${TIMEOUT_MS / 1000} seconds.`)));
    req.on("error", (error: Error & { code?: string }) => resolve({ status: null, body: "", error: (error.code === "EPRIVATE" ? error.message : error.message || error.code || "Connection failed").slice(0, 300), durationMs: Date.now() - started }));
    req.end(body);
  });
}

async function deliverOne(delivery: Delivery, subscription: Subscription, now: Date): Promise<"succeeded" | "retry" | "failed"> {
  const attempt = delivery.attempts + 1;
  const body = JSON.stringify(delivery.payload);
  let result: PostResult;
  const target = checkTargetUrl(subscription.target_url);
  const secret = openSigningSecret(subscription.tenant_id, subscription.id, subscription.signing_secret_ciphertext, subscription.signing_secret_key_version);
  if (!target.ok) result = { status: null, body: "", error: target.message, durationMs: 0 };
  else if (!secret) result = { status: null, body: "", error: "The signing secret could not be opened.", durationMs: 0 };
  else {
    const timestamp = Math.floor(now.getTime() / 1000);
    result = await post(target.url, body, {
      "insurvas-signature": signPayload(secret, body, timestamp),
      "insurvas-event": delivery.event_type,
      "insurvas-delivery": delivery.id,
      "insurvas-event-id": delivery.event_id,
    });
  }
  const ok = result.status !== null && isSuccessStatus(result.status);
  const error = ok ? null : result.error ?? (result.status && result.status >= 300 && result.status < 400 ? `Redirected (${result.status}); redirects are not followed.` : `HTTP ${result.status}`);

  await db().from("webhook_attempt").insert({
    tenant_id: delivery.tenant_id,
    subscription_id: subscription.id,
    delivery_id: delivery.id,
    attempt,
    status_code: result.status,
    ok,
    duration_ms: result.durationMs,
    response_snippet: result.body ? responseSnippet(result.body) : null,
    error,
  });

  const next = nextForDelivery(attempt, { ok }, now);
  await db().from("webhook_delivery").update({
    status: next.status,
    attempts: attempt,
    lease_until: null,
    last_status_code: result.status,
    last_error: error,
    next_attempt_at: next.status === "pending" ? next.nextAttemptAt.toISOString() : now.toISOString(),
    finished_at: next.status === "pending" ? null : now.toISOString(),
  }).eq("id", delivery.id);

  const state = nextForSubscription({ status: subscription.status, consecutiveFailures: subscription.consecutive_failures }, { ok }, next.status === "failed");
  const patch: Record<string, unknown> = { status: state.status, consecutive_failures: state.consecutiveFailures, updated_at: now.toISOString() };
  if (ok) patch.last_success_at = now.toISOString();
  else patch.last_failure_at = now.toISOString();
  if (state.justDisabled) {
    patch.disabled_at = now.toISOString();
    patch.disabled_reason = `Stopped after ${state.consecutiveFailures} failed attempts in a row. Last: ${error ?? "unknown"}`.slice(0, 300);
  }
  await db().from("webhook_subscription").update(patch).eq("id", subscription.id);
  subscription.status = state.status;
  subscription.consecutive_failures = state.consecutiveFailures;

  if (state.justDisabled) {
    // Nothing more goes to a dead endpoint: its waiting deliveries are cancelled, and the owners told.
    await db().from("webhook_delivery").update({ status: "cancelled", finished_at: now.toISOString(), lease_until: null }).eq("subscription_id", subscription.id).in("status", ["pending", "delivering"]);
    await notifyTenantAgents({
      tenantId: subscription.tenant_id,
      kind: "webhook_disabled",
      title: `Webhook "${subscription.label}" was turned off`,
      body: `Deliveries to ${new URL(subscription.target_url).host} kept failing (${error ?? "no answer"}). Fix the receiver, then resume it in Settings › API keys & webhooks.`,
      link: "/app/settings#integrations",
      sourceKey: `webhook-disabled:${subscription.id}:${now.toISOString().slice(0, 13)}`,
      roles: ["owner"],
    }).catch((e: unknown) => console.error("[webhooks] could not notify about a disabled webhook", e instanceof Error ? e.message : e));
  }
  return ok ? "succeeded" : next.status === "failed" ? "failed" : "retry";
}

/** One run: claims up to `limit` due deliveries and sends them, one subscription's in order. */
export async function deliverDueWebhooks(options: { tenantId?: string; limit?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const claimed = await db().rpc("claim_webhook_deliveries", { p_limit: options.limit ?? 50, p_tenant_id: options.tenantId ?? null });
  if (claimed.error) throw new Error(`Could not claim webhook deliveries: ${claimed.error.message}`);
  const deliveries = (claimed.data ?? []) as Delivery[];
  const counts = { claimed: deliveries.length, succeeded: 0, retry: 0, failed: 0 };
  if (!deliveries.length) return counts;

  const ids = [...new Set(deliveries.map((d) => d.subscription_id))];
  const subs = await db().from("webhook_subscription").select("id, tenant_id, label, target_url, status, consecutive_failures, signing_secret_ciphertext, signing_secret_key_version").in("id", ids);
  if (subs.error) throw new Error(`Could not load webhook subscriptions: ${subs.error.message}`);
  const byId = new Map(((subs.data ?? []) as Subscription[]).map((s) => [s.id, s]));

  // Subscriptions in parallel, each one's deliveries in sequence: its failure count is read-modify-write.
  await Promise.all(ids.map(async (id) => {
    const subscription = byId.get(id);
    for (const delivery of deliveries.filter((d) => d.subscription_id === id)) {
      // Disabled during this run: its deliveries were cancelled with it. Gone or paused: hand back.
      if (subscription?.status === "disabled") continue;
      if (!subscription || subscription.status === "paused") {
        await db().from("webhook_delivery").update({ status: "pending", lease_until: null }).eq("id", delivery.id).eq("status", "delivering");
        continue;
      }
      counts[await deliverOne(delivery, subscription, now)]++;
    }
  }));
  await db().rpc("prune_webhook_attempts").then(({ error }: { error: { message: string } | null }) => { if (error) console.error("[webhooks] prune failed", error.message); });
  return counts;
}
