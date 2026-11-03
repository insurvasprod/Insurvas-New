import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { guardProducer } from "@/lib/agency/guards";
import { completeItem, readChecklist } from "@/lib/agency/onboardingStore";
import { storeOnboardingDocument } from "@/lib/agency/documents";
import { refusalResponse } from "@/lib/agency/rpc";
import { NO_STORE } from "@/lib/agency/http";
import { audit } from "@/lib/audit/log";

/**
 * AG-1.10 · the onboarding checklist and the can_submit it derives. Most items complete themselves from the
 * records later modules read (licence, appointments, writing numbers, levels); the owner attests two:
 *   contracting — the owner approves     w9 — the owner uploads
 * (E&O was removed from the checklist 2026-10-26.)
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("team_hierarchy", ["owner", "bookkeeper", "producer"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That producer could not be found." }, { status: 404 });
  const hidden = await guardProducer(auth.context, id);
  if (hidden) return hidden;
  try {
    return NextResponse.json(await readChecklist(auth.context.tenantId, id), { headers: NO_STORE });
  } catch (error) {
    return refusalResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("team_hierarchy", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That producer could not be found." }, { status: 404 });
  const hidden = await guardProducer(auth.context, id);
  if (hidden) return hidden;
  const form = await request.formData().catch(() => null);
  const item = form?.get("item");
  if (item !== "contracting" && item !== "w9") return NextResponse.json({ error: "Choose an item to complete." }, { status: 400 });
  // Contracting and the W-9 are the owner's to attest.
  if (auth.context.role !== "owner") {
    return NextResponse.json({ error: "The owner or an admin completes this item.", code: "owner_only" }, { status: 403 });
  }
  const expiresOn = typeof form?.get("expiresOn") === "string" ? (form!.get("expiresOn") as string) : null;
  if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return NextResponse.json({ error: "Use a date like 2027-06-30." }, { status: 400 });
  try {
    const file = form?.get("file");
    const documentPath = file instanceof File && file.size > 0 && item === "w9" ? await storeOnboardingDocument(auth.context.tenantId, id, item, file) : null;
    const canSubmit = await completeItem({ tenantId: auth.context.tenantId, producerId: id, item, actorId: auth.context.userId, expiresOn, documentPath });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "agency.checklist_item_completed", targetType: "producer", targetId: id, metadata: { tenantId: auth.context.tenantId, item, expiresOn, hasDocument: Boolean(documentPath), canSubmit }, request });
    return NextResponse.json({ ok: true, canSubmit });
  } catch (error) {
    return refusalResponse(error);
  }
}
