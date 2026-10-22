import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { DiscrepancyError, draftDispute, previewLetter, runDetection, setStatus, updateDispute } from "@/lib/ingestion/discrepancyStore";
import { isRecordUuid } from "@/lib/ingestion/path";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-4.15 (Notion sprint) · discrepancies from the carrier files: check now, decide on a finding
 * (dismiss with why, open again), preview and draft a dispute letter, and record what happened to it.
 * We draft; the agent sends. Nothing here contacts a carrier.
 *
 * Owner and bookkeeper, as the discrepancy report.
 */
const roles = ["owner", "bookkeeper"] as const;
const uuid = z.string().refine(isRecordUuid, "Choose from the list.");
const ids = z.array(uuid).min(1, "Choose at least one item.").max(200);

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run") }).strict(),
  z.object({ action: z.literal("set_status"), id: uuid, status: z.enum(["open", "dismissed", "resolved"]), note: z.string().trim().max(2000).nullable() }).strict(),
  z.object({ action: z.literal("preview_letter"), ids, recipient: z.string().trim().max(1000).nullable() }).strict(),
  z.object({ action: z.literal("draft_dispute"), ids, recipient: z.string().trim().max(1000).nullable() }).strict(),
  z.object({ action: z.literal("mark_sent"), dispute_id: uuid, via: z.enum(["email", "portal", "post"]) }).strict(),
  z.object({ action: z.literal("mark_acknowledged"), dispute_id: uuid }).strict(),
  z.object({ action: z.literal("record_outcome"), dispute_id: uuid, outcome: z.enum(["accepted", "rejected", "partial"]), amount_cents: z.number().int("Enter the amount in whole cents.").min(0, "The amount credited can't be negative.").nullable(), notes: z.string().trim().max(4000).nullable() }).strict(),
]);

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("discrepancy_report", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { tenantId, userId } = auth.context;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const b = parsed.data;
  const log = (action: "commission_discrepancy.status_set" | "commission_dispute.drafted" | "commission_dispute.updated", targetType: string, targetId: string, metadata: Record<string, unknown>) => audit({ actorType: "tenant", actorId: userId, action, targetType, targetId, metadata: { tenantId, ...metadata }, request });
  try {
    if (b.action === "run") return NextResponse.json({ ok: true, ...(await runDetection(tenantId)) });
    if (b.action === "set_status") {
      await setStatus(tenantId, userId, b.id, b.status, b.note);
      await log("commission_discrepancy.status_set", "commission_discrepancy", b.id, { status: b.status, note: b.note });
      return NextResponse.json({ ok: true });
    }
    if (b.action === "preview_letter") return NextResponse.json({ ok: true, ...(await previewLetter(tenantId, userId, b.ids, b.recipient)) });
    if (b.action === "draft_dispute") {
      const draft = await draftDispute(tenantId, userId, b.ids, b.recipient);
      await log("commission_dispute.drafted", "commission_dispute", draft.id, { items: b.ids.length, totalCents: draft.totalCents });
      return NextResponse.json({ ok: true, ...draft });
    }
    if (b.action === "mark_sent") await updateDispute(tenantId, b.dispute_id, { action: "sent", via: b.via });
    else if (b.action === "mark_acknowledged") await updateDispute(tenantId, b.dispute_id, { action: "acknowledged" });
    else await updateDispute(tenantId, b.dispute_id, { action: "outcome", outcome: b.outcome, amountCents: b.amount_cents, notes: b.notes });
    await log("commission_dispute.updated", "commission_dispute", b.dispute_id, { change: b.action, ...("via" in b ? { via: b.via } : {}), ...("outcome" in b ? { outcome: b.outcome, amountCents: b.amount_cents } : {}) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof DiscrepancyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[commission-discrepancies]", error);
    return NextResponse.json({ error: "That could not be done" }, { status: 500 });
  }
}
