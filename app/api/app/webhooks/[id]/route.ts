import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { WebhookSchemaPendingError, deleteWebhook, listAttempts, listWebhooks, setWebhookStatus } from "@/lib/webhooks/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { recordSettingsChanges } from "@/lib/settingsAudit/record";

/**
 * One webhook (LA-8.7). GET: its delivery log (last attempts, status codes, response snippets).
 * PATCH: pause, or resume (which also restarts a failing or disabled one). DELETE: remove it and its
 * queue. Owners only.
 */
const patchSchema = z.object({ status: z.enum(["active", "paused"]) }).strict();
const ID = /^[0-9a-f-]{36}$/i;

function failure(error: unknown, fallback: string) {
  if (error instanceof WebhookSchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 400 });
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Unknown webhook" }, { status: 404 });
  try {
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
  if (!parsed.success) return NextResponse.json({ error: "Send a status of active or paused" }, { status: 400 });
  try {
    const record = await setWebhookStatus(auth.context.tenantId, id, parsed.data.status);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: parsed.data.status === "paused" ? "tenant.webhook_paused" : "tenant.webhook_resumed", targetType: "webhook_subscription", targetId: id, metadata: { tenantId: auth.context.tenantId, label: record.label }, request });
    await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "integrations", changes: [{ key: `webhook:${id}`, label: `Webhook “${record.label}”`, from: parsed.data.status === "paused" ? "active" : "paused", to: parsed.data.status }] });
    return NextResponse.json({ record });
  } catch (error) {
    return failure(error, "Could not change the webhook");
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
