import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { API_SCOPE_KEYS, KEY_EXPIRY_DAYS, type ApiScope } from "@/lib/apiKeys/constants";
import { ApiKeySchemaPendingError, createApiKey, listApiKeys } from "@/lib/apiKeys/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { recordSettingsChanges } from "@/lib/settingsAudit/record";

/**
 * Settings › API keys & webhooks (LA-8.7) — the agency's integration keys. Owners only; every other
 * role gets 403. The full key is in the POST response once and nowhere else, ever.
 */

const createSchema = z.object({
  label: z.string().trim().min(1, "Name the key after what uses it").max(80),
  // Explicit, at least one, from the list. There is no "all".
  scopes: z.array(z.enum(API_SCOPE_KEYS as [ApiScope, ...ApiScope[]])).min(1, "Choose at least one scope").max(API_SCOPE_KEYS.length),
  expiresInDays: z.union([z.literal(KEY_EXPIRY_DAYS[0]), z.literal(KEY_EXPIRY_DAYS[1]), z.literal(KEY_EXPIRY_DAYS[2])]).nullable().default(null),
}).strict();

export async function GET() {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ keys: await listApiKeys(auth.context.tenantId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ApiKeySchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    console.error("[api-keys] load failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load API keys" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid key" }, { status: 400 });
  try {
    const expiresAt = parsed.data.expiresInDays ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000).toISOString() : null;
    const created = await createApiKey({ tenantId: auth.context.tenantId, userId: auth.context.userId, label: parsed.data.label, scopes: parsed.data.scopes, expiresAt });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.api_key_created",
      targetType: "api_key",
      targetId: created.record.id,
      // The prefix, never the key.
      metadata: { tenantId: auth.context.tenantId, label: created.record.label, keyPrefix: created.record.keyPrefix, scopes: created.record.scopes, expiresAt },
      request,
    });
    // LA-8.8: the prefix and scopes, never the key.
    await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "integrations", changes: [{ key: `api_key:${created.record.id}`, label: `API key “${created.record.label}”`, from: null, to: `${created.record.keyPrefix}… · ${created.record.scopes.join(", ")}` }] });
    return NextResponse.json({ key: created.key, record: created.record }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ApiKeySchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create the key" }, { status: 400 });
  }
}
