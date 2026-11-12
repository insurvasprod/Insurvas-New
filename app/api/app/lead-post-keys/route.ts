import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { listPostKeys, mintPostKey, PostKeyConflictError } from "@/lib/leadPost/keys";
import { SchemaPendingError } from "@/lib/leadPost/schemaGap";
import { createRealtimeVendor, updateVendorSettings } from "@/lib/leadPost/boardStore";

/**
 * LA-2.5 · the keys a vendor posts leads with.
 *
 * Gated on `lead_import` rather than a key of its own: posting and importing are the same
 * capability seen from two ends — leads arriving from outside — and inventing a feature key that
 * no plan grants would make the screen unreachable for everyone.
 *
 * Owner only, both ways. A posting key lets an outside party write leads into this tenant and bill
 * for them; listing the prefixes is close enough to that to sit behind the same gate as minting.
 */
const ROLES = ["owner"] as const;

const fieldMapSchema = z.record(z.string().trim().min(1).max(120), z.string().trim().min(1).max(120));
const fieldNotesSchema = z.record(z.string().trim().min(1).max(120), z.string().trim().max(200));

const mintSchema = z
  .object({
    // A vendor from the list, or (round 8 "type a new name") a new real-time vendor by name.
    vendorId: z.string().uuid().optional(),
    vendorName: z.string().trim().min(1).max(160).optional(),
    // Round 8 (20261112100100): start in test mode, and the price per accepted lead in cents.
    testMode: z.boolean().optional(),
    priceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
    fieldMap: fieldMapSchema.default({}),
    fieldNotes: fieldNotesSchema.optional(),
    // Optional: an unbound key posts to the vendor's accepting campaign, as keys always have.
    campaignId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.vendorId || value.vendorName), "Choose a vendor or type a new name");

export async function GET() {
  const auth = await requireFeatureRole("lead_import", ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await listPostKeys(auth.context.tenantId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load your posting keys" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("lead_import", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;

  const parsed = mintSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid key" }, { status: 400 });

  try {
    const vendorId = parsed.data.vendorId ?? (await createRealtimeVendor(auth.context.tenantId, auth.context.userId, parsed.data.vendorName ?? ""));
    const minted = await mintPostKey({
      tenantId: auth.context.tenantId,
      userId: auth.context.userId,
      vendorId,
      fieldMap: parsed.data.fieldMap,
      fieldNotes: parsed.data.fieldNotes,
      campaignId: parsed.data.campaignId ?? null,
    });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.post_key_minted",
      targetType: "tenant_vendor_post_keys",
      targetId: minted.record.id,
      // The prefix, never the key. An audit row holding the secret would undo the reason the table
      // stores only a hash.
      metadata: {
        vendorId,
        newVendor: !parsed.data.vendorId,
        keyPrefix: minted.record.keyPrefix,
        mappedFields: Object.keys(parsed.data.fieldMap).length,
        campaignId: parsed.data.campaignId ?? null,
      },
      request,
    });
    // Round 8: nothing is live until the first test passes, once test mode exists; a price if given.
    let settingsSaved = false;
    if (parsed.data.testMode !== undefined || parsed.data.priceCents !== undefined) {
      try {
        await updateVendorSettings(auth.context.tenantId, minted.record.id, { testMode: parsed.data.testMode, priceCents: parsed.data.priceCents });
        settingsSaved = true;
      } catch (error) {
        if (!(error instanceof SchemaPendingError)) throw error;
      }
    }
    // The one response that ever contains the key itself.
    return NextResponse.json({ key: minted.key, record: minted.record, settingsSaved }, { status: 201 });
  } catch (error) {
    if (error instanceof SchemaPendingError) return NextResponse.json({ error: error.message }, { status: 503 });
    // One active key per vendor (LA-2.5-2): a second is refused, and the message says to rotate.
    if (error instanceof PostKeyConflictError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create the posting key" },
      { status: 400 },
    );
  }
}
