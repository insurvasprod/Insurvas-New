import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { isRecordUuid } from "@/lib/ingestion/path";
import { deleteFilter, PolicyBookError, saveAnnotation, saveFilter } from "@/lib/ingestion/policyBookStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-4.11 (Notion sprint) · the policy list and page write only what is the agency's own: a policy's
 * notes and lead source, and each person's saved filters. Carrier data is read-only everywhere.
 *
 * Owner, producer and bookkeeper, as the policy list. A producer only reaches policies credited to
 * them (checked again in the store).
 */
const roles = ["owner", "producer", "bookkeeper"] as const;
const uuid = z.string().refine(isRecordUuid, "Choose from the list.");

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_filter"), name: z.string().trim().min(1, "Name the filter.").max(60, "Keep the name under 60 characters."), query: z.string().max(2000) }).strict(),
  z.object({ action: z.literal("delete_filter"), id: uuid }).strict(),
  z.object({
    action: z.literal("save_annotation"),
    carrier_id: uuid,
    policy_number: z.string().min(1).max(100),
    notes: z.string().max(4000, "Keep notes under 4,000 characters.").nullable(),
    lead_vendor_id: uuid.nullable(),
    lead_campaign_id: uuid.nullable(),
  }).strict(),
]);

function failure(error: unknown, fallback: string) {
  if (error instanceof PolicyBookError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`[policy-book] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { tenantId, userId, role } = auth.context;
  const viewer = { tenantId, userId, role };
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const input = parsed.data;
  try {
    if (input.action === "save_filter") {
      const saved = await saveFilter(viewer, input.name, input.query);
      return NextResponse.json({ ok: true, id: saved.id });
    }
    if (input.action === "delete_filter") {
      await deleteFilter(viewer, input.id);
      return NextResponse.json({ ok: true });
    }
    await saveAnnotation(viewer, { carrierId: input.carrier_id, policyNumber: input.policy_number, notes: input.notes, leadVendorId: input.lead_vendor_id, leadCampaignId: input.lead_campaign_id });
    await audit({ actorType: "tenant", actorId: userId, action: "policy.annotated", targetType: "policy", targetId: `${input.carrier_id}:${input.policy_number}`, metadata: { tenantId, carrierId: input.carrier_id, notesChanged: input.notes !== null, leadVendorId: input.lead_vendor_id, leadCampaignId: input.lead_campaign_id }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error, "That could not be saved");
  }
}
