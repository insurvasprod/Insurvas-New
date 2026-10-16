import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { ApiKeySchemaPendingError, revokeApiKey } from "@/lib/apiKeys/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { recordSettingsChanges } from "@/lib/settingsAudit/record";

/**
 * DELETE /api/app/api-keys/:id — revoke. The next request with the key is refused: every request
 * reads the key's row. The row stays, revoked, so the list keeps its history. Owners only.
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Unknown key" }, { status: 404 });
  try {
    const record = await revokeApiKey({ tenantId: auth.context.tenantId, userId: auth.context.userId, keyId: id });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.api_key_revoked", targetType: "api_key", targetId: id, metadata: { tenantId: auth.context.tenantId, label: record.label, keyPrefix: record.keyPrefix }, request });
    await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "integrations", changes: [{ key: `api_key:${id}`, label: `API key “${record.label}”`, from: `${record.keyPrefix}…`, to: null, changeType: "delete" }] });
    return NextResponse.json({ record });
  } catch (error) {
    if (error instanceof ApiKeySchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not revoke the key" }, { status: 400 });
  }
}
