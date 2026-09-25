import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { rotatePostKey, setPostKeyActive, setPostKeyCampaign, updatePostKeyFieldMap } from "@/lib/leadPost/keys";
import { SchemaPendingError } from "@/lib/leadPost/schemaGap";

const ROLES = ["owner"] as const;

const patchSchema = z
  .object({
    action: z.enum(["rotate", "activate", "deactivate", "field_map", "campaign"]),
    fieldMap: z.record(z.string().trim().min(1).max(120), z.string().trim().min(1).max(120)).optional(),
    // A note per mapped field, keyed by our field. Sent with action "field_map".
    fieldNotes: z.record(z.string().trim().min(1).max(120), z.string().trim().max(200)).optional(),
    // With action "campaign": the campaign to bind, or null to unbind.
    campaignId: z.string().uuid().nullable().optional(),
  })
  .strict();

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("lead_import", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success)
    return NextResponse.json({ error: "That is not a key id", code: "invalid_id" }, { status: 400 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid change" }, { status: 400 });

  try {
    if (parsed.data.action === "rotate") {
      const minted = await rotatePostKey({ tenantId: auth.context.tenantId, userId: auth.context.userId, keyId: id });
      await audit({
        actorType: "tenant",
        actorId: auth.context.userId,
        action: "tenant.post_key_rotated",
        targetType: "tenant_vendor_post_keys",
        targetId: minted.record.id,
        metadata: { replacedKeyId: id, keyPrefix: minted.record.keyPrefix, vendorId: minted.record.vendorId },
        request,
      });
      return NextResponse.json({ key: minted.key, record: minted.record });
    }

    if (parsed.data.action === "field_map") {
      if (!parsed.data.fieldMap)
        return NextResponse.json({ error: "Send the field map", code: "field_map_required" }, { status: 400 });
      await updatePostKeyFieldMap({ tenantId: auth.context.tenantId, keyId: id, fieldMap: parsed.data.fieldMap, fieldNotes: parsed.data.fieldNotes });
      await audit({
        actorType: "tenant",
        actorId: auth.context.userId,
        action: "tenant.post_key_updated",
        targetType: "tenant_vendor_post_keys",
        targetId: id,
        metadata: { mappedFields: Object.keys(parsed.data.fieldMap).length, notes: Object.keys(parsed.data.fieldNotes ?? {}).length },
        request,
      });
      return NextResponse.json({ ok: true });
    }

    if (parsed.data.action === "campaign") {
      if (parsed.data.campaignId === undefined)
        return NextResponse.json({ error: "Send the campaign, or null to unbind", code: "campaign_required" }, { status: 400 });
      await setPostKeyCampaign({ tenantId: auth.context.tenantId, keyId: id, campaignId: parsed.data.campaignId });
      await audit({
        actorType: "tenant",
        actorId: auth.context.userId,
        action: "tenant.post_key_updated",
        targetType: "tenant_vendor_post_keys",
        targetId: id,
        // Which campaign a vendor's posts land on decides who pays for them.
        metadata: { campaignId: parsed.data.campaignId },
        request,
      });
      return NextResponse.json({ ok: true });
    }

    const isActive = parsed.data.action === "activate";
    const record = await setPostKeyActive({ tenantId: auth.context.tenantId, keyId: id, isActive });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.post_key_updated",
      targetType: "tenant_vendor_post_keys",
      targetId: id,
      // Deactivating a key stops a vendor delivering and stops the invoices with it. That is a
      // commercial act, not a toggle, so it is recorded as one.
      metadata: { isActive, keyPrefix: record.keyPrefix },
      request,
    });
    return NextResponse.json({ record });
  } catch (error) {
    if (error instanceof SchemaPendingError) return NextResponse.json({ error: error.message }, { status: 503 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not change that key" },
      { status: 400 },
    );
  }
}
