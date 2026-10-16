import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { DEFAULT_ROTATION_OVERLAP_HOURS, ROTATION_OVERLAP_HOURS } from "@/lib/apiKeys/constants";
import { ApiKeyAlreadyRotatedError, ApiKeySchemaPendingError, rotateApiKey } from "@/lib/apiKeys/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { recordSettingsChanges } from "@/lib/settingsAudit/record";

/**
 * POST /api/app/api-keys/:id/rotate — a new key with the same name and scopes; the old one keeps
 * working for the overlap (default 24 hours) and then stops. The new key is in this response once.
 */
const schema = z.object({
  overlapHours: z.union([z.literal(ROTATION_OVERLAP_HOURS[0]), z.literal(ROTATION_OVERLAP_HOURS[1]), z.literal(ROTATION_OVERLAP_HOURS[2])]).default(DEFAULT_ROTATION_OVERLAP_HOURS),
}).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Unknown key" }, { status: 404 });
  const parsed = schema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Choose an overlap of 1, 24 or 72 hours" }, { status: 400 });
  try {
    const rotated = await rotateApiKey({ tenantId: auth.context.tenantId, userId: auth.context.userId, keyId: id, overlapHours: parsed.data.overlapHours });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.api_key_rotated",
      targetType: "api_key",
      targetId: rotated.record.id,
      metadata: { tenantId: auth.context.tenantId, replaces: id, keyPrefix: rotated.record.keyPrefix, oldKeyEndsAt: rotated.oldExpiresAt, overlapHours: parsed.data.overlapHours },
      request,
    });
    await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "integrations", changes: [{ key: `api_key:${id}`, label: `API key “${rotated.record.label}” rotated`, from: `old key, works until ${rotated.oldExpiresAt.slice(0, 16).replace("T", " ")} UTC`, to: `${rotated.record.keyPrefix}…` }] });
    return NextResponse.json({ key: rotated.key, record: rotated.record, oldExpiresAt: rotated.oldExpiresAt }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ApiKeySchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    if (error instanceof ApiKeyAlreadyRotatedError) return NextResponse.json({ error: error.message, code: "already_rotated" }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not rotate the key" }, { status: 400 });
  }
}
