import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { API_SCOPE_KEYS, API_SCOPES, type ApiScope } from "@/lib/apiKeys/constants";
import { ApiKeySchemaPendingError, revokeApiKey, updateApiKey } from "@/lib/apiKeys/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { recordSettingsChanges } from "@/lib/settingsAudit/record";

/**
 * PATCH /api/app/api-keys/:id — the key's sheet: rename it, narrow its scopes, set or move its end
 * (never widen: that is a new key). `keep: true` answers the 90-day idle question with "keep it",
 * written to the settings history so the next person sees who kept it. Owners only.
 */
const patchSchema = z.object({
  label: z.string().trim().min(1, "Name the key after what uses it").max(80).optional(),
  scopes: z.array(z.enum(API_SCOPE_KEYS as [ApiScope, ...ApiScope[]])).min(1, "A key must be able to do at least one thing").max(API_SCOPE_KEYS.length).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  keep: z.literal(true).optional(),
}).strict();

const scopeWords = (scopes: readonly string[]) => scopes.map((scope) => API_SCOPES.find((item) => item.key === scope)?.label ?? scope).join(", ");

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Unknown key" }, { status: 404 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Those changes are not valid" }, { status: 400 });
  try {
    const { before, record } = await updateApiKey({ tenantId: auth.context.tenantId, keyId: id, label: parsed.data.label, scopes: parsed.data.scopes, expiresAt: parsed.data.expiresAt });
    const changes: { key: string; label: string; from: string | null; to: string | null }[] = [];
    if (before.label !== record.label) changes.push({ key: `api_key:${id}:label`, label: `API key “${record.label}” name`, from: before.label, to: record.label });
    if (before.scopes.join() !== record.scopes.join()) changes.push({ key: `api_key:${id}:scopes`, label: `API key “${record.label}” can do`, from: scopeWords(before.scopes), to: scopeWords(record.scopes) });
    if (before.expiresAt !== record.expiresAt) changes.push({ key: `api_key:${id}:ends`, label: `API key “${record.label}” ends`, from: before.expiresAt ? before.expiresAt.slice(0, 10) : "never", to: record.expiresAt ? record.expiresAt.slice(0, 10) : "never" });
    if (parsed.data.keep) changes.push({ key: `api_key:${id}:kept`, label: `API key “${record.label}” kept after going unused`, from: before.lastUsedAt ? `last used ${before.lastUsedAt.slice(0, 10)}` : "never used", to: "kept" });
    // The settings history carries these (there is no audit action for a key edit yet).
    if (changes.length) await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "integrations", changes });
    return NextResponse.json({ record });
  } catch (error) {
    if (error instanceof ApiKeySchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the key" }, { status: 400 });
  }
}

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
