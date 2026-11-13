import { NextResponse } from "next/server";
import { z } from "zod";

import { body, failure } from "@/lib/applications/http";
import { blockExtension, listExtensionPeople, unblockExtension } from "@/lib/extension/accessBlocks";
import { carrierSites, revokeGrants } from "@/lib/extension/grants";
import { actorOf, NO_STORE } from "@/lib/extension/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { db, rows } from "@/lib/applications/db";
import { memberSnapshot, recordSettingsChanges } from "@/lib/settingsAudit/record";

/**
 * Settings round 8 · Browser extension › Who can use it. Owners only.
 *   GET     every owner and agent who may use the extension, the carrier sites with this month's fills,
 *           and the last fill.
 *   POST    revoke one person, for every carrier site or one carrier: their live grants end now, and (once
 *           20261112310000 is applied) they cannot open a new one.
 *   DELETE  give a person the extension back, for every site or one carrier.
 */
const personSchema = z.object({ userId: z.string().uuid(), carrierId: z.string().uuid().nullable().default(null) }).strict();

export async function GET() {
  const auth = await requireFeatureRole("carrier_extension", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await listExtensionPeople(auth.context.tenantId), { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireFeatureRole("carrier_extension", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  const input = await body(request, personSchema);
  if (input instanceof NextResponse) return input;
  try {
    const tenantId = auth.context.tenantId;
    // The person's live grants, on one carrier's site when one is named.
    let origin: string | null = null;
    if (input.carrierId) origin = (await carrierSites(tenantId)).find((site) => site.carrierId === input.carrierId)?.origin ?? null;
    let live = db().from("tenant_extension_grants").select("id").eq("tenant_id", tenantId).eq("user_id", input.userId).is("revoked_at", null).gt("expires_at", new Date().toISOString());
    if (input.carrierId) live = live.eq("carrier_origin", origin ?? "none");
    const found = await live;
    let revoked = 0;
    const actor = actorOf(auth, request);
    for (const grant of found.error ? [] : rows<{ id: string }>(found.data)) revoked += (await revokeGrants(actor, grant.id)).revoked;
    const blocked = await blockExtension(tenantId, input.userId, input.carrierId, auth.context.userId);
    if (blocked) {
      const who = await memberSnapshot(tenantId, input.userId);
      await recordSettingsChanges({ tenantId, actorId: auth.context.userId, section: "sales-extension", changes: [{ key: `extension:${input.userId}${input.carrierId ? `.${input.carrierId}` : ""}`, label: `${who.name} — browser extension${input.carrierId ? " (one carrier)" : ""}`, from: "allowed", to: "revoked" }] });
    }
    return NextResponse.json({ revoked, blocked, blocksReady: blocked }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireFeatureRole("carrier_extension", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  const input = await body(request, personSchema);
  if (input instanceof NextResponse) return input;
  try {
    const done = await unblockExtension(auth.context.tenantId, input.userId, input.carrierId);
    if (done) {
      const who = await memberSnapshot(auth.context.tenantId, input.userId);
      await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "sales-extension", changes: [{ key: `extension:${input.userId}${input.carrierId ? `.${input.carrierId}` : ""}`, label: `${who.name} — browser extension${input.carrierId ? " (one carrier)" : ""}`, from: "revoked", to: "allowed" }] });
    }
    return NextResponse.json({ ok: done, blocksReady: done }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
