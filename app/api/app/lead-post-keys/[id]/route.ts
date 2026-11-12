import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { PostKeyConflictError, rotatePostKey, setPostKeyActive, setPostKeyCampaign, updatePostKeyFieldMap } from "@/lib/leadPost/keys";
import { SchemaPendingError } from "@/lib/leadPost/schemaGap";
import { afterRotate, endGrace, leadPostR8Ready, makeInstructionsLink, markInstructionsSent, updateVendorSettings } from "@/lib/leadPost/boardStore";

const ROLES = ["owner"] as const;

const patchSchema = z
  .object({
    action: z.enum(["rotate", "activate", "deactivate", "field_map", "campaign", "settings", "instructions_sent", "instructions_link"]),
    // With action "rotate": hours the old key keeps working (round 8; 0 = stops now).
    graceHours: z.number().int().min(0).max(72).optional(),
    // With action "settings" (round 8, needs 20261112100100).
    settings: z
      .object({
        priceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
        dailyCap: z.number().int().min(1).max(100_000).nullable().optional(),
        postingHours: z
          .object({
            days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
            start: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/),
            end: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/),
            timeZone: z.string().min(1).max(64),
          })
          .nullable()
          .optional(),
        callbackUrl: z.string().trim().max(500).nullable().optional(),
        callbackEvents: z.array(z.enum(["accepted", "refused"])).max(2).optional(),
        notes: z.string().max(2000).optional(),
        testMode: z.boolean().optional(),
      })
      .strict()
      .optional(),
    // With action "instructions_sent": who the owner emailed them to.
    email: z.string().trim().email().max(320).nullable().optional(),
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
    if (parsed.data.action === "settings") {
      if (!parsed.data.settings) return NextResponse.json({ error: "Send the settings" }, { status: 400 });
      await updateVendorSettings(auth.context.tenantId, id, parsed.data.settings);
      await audit({
        actorType: "tenant",
        actorId: auth.context.userId,
        action: "tenant.post_key_updated",
        targetType: "tenant_vendor_post_keys",
        targetId: id,
        // Price, cap and test mode decide what a vendor can bill; the callback address is where we send outcomes.
        metadata: { settings: Object.keys(parsed.data.settings), testMode: parsed.data.settings.testMode ?? null, priceCents: parsed.data.settings.priceCents ?? null },
        request,
      });
      return NextResponse.json({ ok: true });
    }

    if (parsed.data.action === "instructions_sent") {
      await markInstructionsSent(auth.context.tenantId, id, parsed.data.email ?? null);
      return NextResponse.json({ ok: true });
    }

    if (parsed.data.action === "instructions_link") {
      const token = await makeInstructionsLink(auth.context.tenantId, id);
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.post_key_updated", targetType: "tenant_vendor_post_keys", targetId: id, metadata: { instructionsLink: true }, request });
      // The token is returned once; only its hash is kept.
      return NextResponse.json({ url: `${request.nextUrl.origin}/api/post/${auth.context.tenantId}/guide/${token}` });
    }

    if (parsed.data.action === "rotate") {
      const graceHours = parsed.data.graceHours ?? 0;
      // A grace window needs 20261112100100; refused before the rotation, so the old key never stops unexpectedly.
      if (graceHours > 0 && !(await leadPostR8Ready())) throw new SchemaPendingError();
      const minted = await rotatePostKey({ tenantId: auth.context.tenantId, userId: auth.context.userId, keyId: id });
      const { graceUntil } = await afterRotate(auth.context.tenantId, id, minted.record.id, graceHours);
      await audit({
        actorType: "tenant",
        actorId: auth.context.userId,
        action: "tenant.post_key_rotated",
        targetType: "tenant_vendor_post_keys",
        targetId: minted.record.id,
        metadata: { replacedKeyId: id, keyPrefix: minted.record.keyPrefix, vendorId: minted.record.vendorId, graceUntil },
        request,
      });
      return NextResponse.json({ key: minted.key, record: minted.record, graceUntil });
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
    // Revoking also ends any grace window an older key of the vendor still has.
    if (!isActive) await endGrace(auth.context.tenantId, id);
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
    // One active key per vendor (LA-2.5-2): a second is refused, and the message says to rotate.
    if (error instanceof PostKeyConflictError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not change that key" },
      { status: 400 },
    );
  }
}
