import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { hasFeature } from "@/lib/entitlements/types";
import { isRecordUuid } from "@/lib/ingestion/path";
import { phonePolicy } from "@/lib/ingestion/policyPhone";
import { isMoreChip, phoneBookPageMore, policyMore } from "@/lib/ingestion/policyPhoneMore";
import { deleteFilter, PolicyBookError, saveAnnotation, saveFilter } from "@/lib/ingestion/policyBookStore";
import { scopeFor } from "@/lib/agency/visibility";
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

/**
 * The phone's Book (mobile board F1, F2, F2b): the same list and policy page the web reads, as JSON. Without a
 * policy: one page of the list (?q= name, policy number or phone; ?chip= inforce|pending|lapsed|chargedback|behind; ?offset=).
 * With ?carrierId=&policyNumber=: that policy, its figures, where each came from, and its commission lines.
 * The same people as the web's Policies; a producer reaches only the policies credited to them (in the store).
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", roles, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const { tenantId, userId, role } = auth.context;
  const viewer = { tenantId, userId, role, scope: await scopeFor(auth.context) };
  const params = request.nextUrl.searchParams;
  const carrierId = params.get("carrierId");
  const policyNumber = params.get("policyNumber");
  try {
    if (carrierId || policyNumber) {
      if (!carrierId || !isRecordUuid(carrierId) || !policyNumber || policyNumber.length > 100) return NextResponse.json({ error: "Choose a policy from the list." }, { status: 400 });
      // "Open the case" follows the web: Retention cases are the owner's, producers' and retention's, on chargeback_radar.
      const held = auth.context.roles?.length ? auth.context.roles : [role];
      const canSeeCase = held.some((r) => r === "owner" || r === "producer" || r === "retention") && hasFeature(auth.entitlement, "chargeback_radar");
      const policy = await phonePolicy(viewer, carrierId, policyNumber, { canSeeCase });
      if (!policy) return NextResponse.json({ error: role === "producer" ? "This policy is not in your book. It may be credited to another agent, or its carrier file hasn't arrived yet." : "This policy is not in your book. Its carrier file may not have arrived yet." }, { status: 404 });
      // Board F2 / F2b (2026-11-27, additive): the beneficiary, "drafts cleared", the expected lines and the split
      // (lib/ingestion/policyPhoneMore.ts), and whether this viewer may open a Retention case on it at all.
      const more = policy.kind === "policy"
        ? await policyMore(viewer, carrierId, policyNumber, { behind: policy.behind, monthsPaid: policy.monthsPaid, lines: policy.money.lines, agentName: policy.agentName }).catch(() => null)
        : null;
      return NextResponse.json({ ok: true, policy: more ? { ...policy, ...more } : policy, role, readOnly: auth.entitlement.access === "read_only", canOpenCase: canSeeCase }, { headers: { "Cache-Control": "no-store" } });
    }
    // Board F1's chips: In force, Pending, Lapsed, Charged back (Behind still answers for an older app).
    const chip = params.get("chip");
    const page = await phoneBookPageMore(viewer, { q: params.get("q") ?? "", chip: isMoreChip(chip) ? chip : null, offset: Number(params.get("offset")) || 0 });
    return NextResponse.json({ ok: true, ...page, scoped: role === "producer" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error, "The book could not be loaded");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { tenantId, userId, role } = auth.context;
  // AG-0.5 · the annotation write finds its policy through the viewer's producer scope (agent_user_id): another
  // producer's policy is "not in your book" (404). Saved filters are the session's own rows already.
  const viewer = { tenantId, userId, role, scope: await scopeFor(auth.context) };
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
