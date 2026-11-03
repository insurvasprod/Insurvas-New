import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { ApplicationKeyMissingError } from "@/lib/applications/crypto";
import { webhookInputSchema } from "@/lib/webhooks/schemas";
import { WebhookSchemaPendingError, createWebhook, listWebhooks } from "@/lib/webhooks/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { recordSettingsChanges } from "@/lib/settingsAudit/record";

/**
 * Settings › API keys & webhooks (LA-8.7) — the agency's webhook subscriptions. Owners only. The
 * signing secret is in the POST response once and never again.
 */
export async function GET() {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ webhooks: await listWebhooks(auth.context.tenantId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WebhookSchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    console.error("[webhooks] load failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load webhooks" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = webhookInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid webhook" }, { status: 400 });
  try {
    const created = await createWebhook(auth.context.tenantId, auth.context.userId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.webhook_created", targetType: "webhook_subscription", targetId: created.record.id, metadata: { tenantId: auth.context.tenantId, label: created.record.label, host: new URL(created.record.targetUrl).host, eventTypes: created.record.eventTypes }, request });
    await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "integrations", changes: [{ key: `webhook:${created.record.id}`, label: `Webhook “${created.record.label}”`, from: null, to: `${new URL(created.record.targetUrl).host} · ${created.record.eventTypes.join(", ")}` }] });
    return NextResponse.json({ secret: created.secret, record: created.record }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WebhookSchemaPendingError || error instanceof ApplicationKeyMissingError) return NextResponse.json({ error: error.message }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create the webhook" }, { status: 400 });
  }
}
