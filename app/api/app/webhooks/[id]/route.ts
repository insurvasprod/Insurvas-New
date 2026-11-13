import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { WEBHOOK_EVENT_KEYS, webhookEventLabel, type WebhookEventType } from "@/lib/apiKeys/constants";
import { hostOf } from "@/lib/apiKeys/hub";
import { deliveryLog, newSigningSecret, retryWebhook, updateWebhook } from "@/lib/apiKeys/webhookOps";
import { ApplicationKeyMissingError } from "@/lib/applications/crypto";
import { WebhookSchemaPendingError, deleteWebhook, listAttempts, listWebhooks, setWebhookStatus } from "@/lib/webhooks/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { recordSettingsChanges } from "@/lib/settingsAudit/record";

/**
 * One webhook (LA-8.7; Settings › Integrations, round 8).
 * GET: its delivery log (last attempts, status codes, response snippets); `?view=deliveries` adds
 *   where each delivery stands (waiting and its next try, delivered, given up) and a few named fields
 *   of what was sent — never the body.
 * PATCH: pause or resume ({ status }); change its name, address or events; or { newSecret: true } for
 *   a new signing secret, in this response once.
 * POST: "Retry now" — { mode: "waiting" | "missed" | "delivery", deliveryId? }.
 * DELETE: remove it and its queue. Owners only.
 */
const patchSchema = z.union([
  z.object({ status: z.enum(["active", "paused"]) }).strict(),
  z.object({ newSecret: z.literal(true) }).strict(),
  z.object({
    label: z.string().trim().min(1, "Name the webhook").max(80).optional(),
    targetUrl: z.string().trim().min(1, "Enter the address to send to").max(500).refine((value) => value.toLowerCase().startsWith("https://"), "Must start with https:// so deliveries are encrypted on the way.").optional(),
    eventTypes: z.array(z.enum(WEBHOOK_EVENT_KEYS as [WebhookEventType, ...WebhookEventType[]])).min(1, "Choose at least one event").max(WEBHOOK_EVENT_KEYS.length).optional(),
  }).strict(),
]);
const retrySchema = z.object({ mode: z.enum(["waiting", "missed", "delivery"]), deliveryId: z.string().uuid().optional() }).strict();
const ID = /^[0-9a-f-]{36}$/i;

function failure(error: unknown, fallback: string) {
  if (error instanceof WebhookSchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
  if (error instanceof ApplicationKeyMissingError) return NextResponse.json({ error: error.message }, { status: 503 });
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 400 });
}

const eventWords = (events: readonly string[]) => events.map(webhookEventLabel).join(", ");

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Unknown webhook" }, { status: 404 });
  try {
    if (request.nextUrl.searchParams.get("view") === "deliveries") {
      return NextResponse.json(await deliveryLog(auth.context.tenantId, id), { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ attempts: await listAttempts(auth.context.tenantId, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error, "Could not load the delivery log");
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Unknown webhook" }, { status: 404 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Those changes are not valid" }, { status: 400 });
  const body = parsed.data;
  try {
    if ("status" in body) {
      const record = await setWebhookStatus(auth.context.tenantId, id, body.status);
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: body.status === "paused" ? "tenant.webhook_paused" : "tenant.webhook_resumed", targetType: "webhook_subscription", targetId: id, metadata: { tenantId: auth.context.tenantId, label: record.label }, request });
      await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "integrations", changes: [{ key: `webhook:${id}`, label: `Webhook “${record.label}”`, from: body.status === "paused" ? "active" : "paused", to: body.status }] });
      return NextResponse.json({ record });
    }
    if ("newSecret" in body) {
      const made = await newSigningSecret(auth.context.tenantId, id);
      // The fact of it, never the secret.
      await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "integrations", changes: [{ key: `webhook:${id}:secret`, label: `Webhook “${made.label}” signing secret`, from: "old secret", to: "new secret" }] });
      return NextResponse.json({ secret: made.secret }, { headers: { "Cache-Control": "no-store" } });
    }
    const { before, record } = await updateWebhook(auth.context.tenantId, id, body);
    const changes: { key: string; label: string; from: string | null; to: string | null }[] = [];
    if (before.label !== record.label) changes.push({ key: `webhook:${id}:label`, label: `Webhook “${record.label}” name`, from: before.label, to: record.label });
    if (before.targetUrl !== record.targetUrl) changes.push({ key: `webhook:${id}:address`, label: `Webhook “${record.label}” address`, from: hostOf(before.targetUrl), to: hostOf(record.targetUrl) });
    if (eventWords(before.eventTypes) !== eventWords(record.eventTypes)) changes.push({ key: `webhook:${id}:events`, label: `Webhook “${record.label}” events`, from: eventWords(before.eventTypes), to: eventWords(record.eventTypes) });
    if (changes.length) await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "integrations", changes });
    return NextResponse.json({ record });
  } catch (error) {
    return failure(error, "Could not change the webhook");
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Unknown webhook" }, { status: 404 });
  const parsed = retrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Say what to retry" }, { status: 400 });
  try {
    const result = await retryWebhook(auth.context.tenantId, id, parsed.data.mode, parsed.data.deliveryId);
    if (result.turnedOn) {
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.webhook_resumed", targetType: "webhook_subscription", targetId: id, metadata: { tenantId: auth.context.tenantId, resent: result.queued }, request });
      await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "integrations", changes: [{ key: `webhook:${id}`, label: "Webhook turned back on", from: "turned off", to: `active · ${result.queued} missed events sent again` }] });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error, "Could not retry");
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Unknown webhook" }, { status: 404 });
  try {
    const before = (await listWebhooks(auth.context.tenantId).catch(() => [])).find((hook) => hook.id === id);
    await deleteWebhook(auth.context.tenantId, id);
    await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "integrations", changes: [{ key: `webhook:${id}`, label: `Webhook “${before?.label ?? "deleted"}”`, from: before ? new URL(before.targetUrl).host : "webhook", to: null, changeType: "delete" }] });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.webhook_deleted", targetType: "webhook_subscription", targetId: id, metadata: { tenantId: auth.context.tenantId }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error, "Could not delete the webhook");
  }
}
