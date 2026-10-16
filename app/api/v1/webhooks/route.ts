import { type NextRequest } from "next/server";

import { apiError, apiJson, authenticateApiKey } from "@/lib/apiKeys/authenticate";
import { ApplicationKeyMissingError } from "@/lib/applications/crypto";
import { webhookInputSchema } from "@/lib/webhooks/schemas";
import { createWebhook, listWebhooks } from "@/lib/webhooks/service";

/**
 * LA-8.7 · /api/v1/webhooks (webhooks:manage). The same subscriptions, rules and one-time secret as
 * Settings › API keys & webhooks; created here, they are listed there too.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, "GET /api/v1/webhooks");
  if (auth instanceof Response) return auth;
  try {
    const webhooks = await listWebhooks(auth.tenantId);
    return apiJson({ data: webhooks.map((w) => ({ id: w.id, label: w.label, target_url: w.targetUrl, event_types: w.eventTypes, status: w.status, created_at: w.createdAt, last_success_at: w.lastSuccessAt, last_failure_at: w.lastFailureAt })) });
  } catch {
    return apiError(500, "internal", "Webhooks could not be read.");
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request, "POST /api/v1/webhooks");
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null);
  const parsed = webhookInputSchema.safeParse(body && typeof body === "object" ? { label: body.label, targetUrl: body.target_url, eventTypes: body.event_types } : null);
  if (!parsed.success) return apiError(400, "invalid_body", parsed.error.issues[0]?.message ?? "Send label, target_url and event_types.");
  try {
    // A subscription made by a key has no person behind it; created_by stays empty.
    const created = await createWebhook(auth.tenantId, null, parsed.data);
    return apiJson({ id: created.record.id, label: created.record.label, target_url: created.record.targetUrl, event_types: created.record.eventTypes, status: created.record.status, signing_secret: created.secret }, { status: 201 });
  } catch (error) {
    if (error instanceof ApplicationKeyMissingError) return apiError(503, "unavailable", "Webhooks cannot be created right now.");
    return apiError(400, "invalid_body", error instanceof Error ? error.message : "Could not create the webhook.");
  }
}
