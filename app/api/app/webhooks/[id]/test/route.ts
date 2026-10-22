import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { deliverDueWebhooks } from "@/lib/webhooks/deliver";
import { WebhookSchemaPendingError, listAttempts, queueTestEvent } from "@/lib/webhooks/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";

/**
 * POST /api/app/webhooks/:id/test — queue a `webhook.test` event and send this agency's due
 * deliveries now, so the owner sees the receiver's answer without waiting for the job. Answers with
 * the test's first attempt as it appears in the log.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Unknown webhook" }, { status: 404 });
  try {
    const deliveryId = await queueTestEvent(auth.context.tenantId, id);
    await deliverDueWebhooks({ tenantId: auth.context.tenantId, limit: 20 });
    const attempt = (await listAttempts(auth.context.tenantId, id, 20)).find((row) => row.deliveryId === deliveryId) ?? null;
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.webhook_tested", targetType: "webhook_subscription", targetId: id, metadata: { tenantId: auth.context.tenantId, statusCode: attempt?.statusCode ?? null, ok: attempt?.ok ?? null }, request });
    return NextResponse.json({ attempt });
  } catch (error) {
    if (error instanceof WebhookSchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send a test" }, { status: 400 });
  }
}
