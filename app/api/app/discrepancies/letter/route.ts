import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { letterItems, listDiscrepancies } from "@/lib/discrepancies/service";
import { isRecordId } from "@/lib/ledger/statementConstants";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary (LA-4.5): a dispute letter was printed. POST `{ carrier, ids }` records it in the
 * audit log, once per print, with exactly what the letter listed: the findings that are this
 * workspace's, for that one carrier, and still apply (the same rule the letter page draws with).
 *
 * Printing is reading, so a read-only account may print and this is NOT a write. Marking the items
 * disputed is a separate decision (PATCH /api/app/discrepancies), which read-only cannot make.
 *
 * Owner and bookkeeper only, as the Discrepancies page.
 */
const roles = ["owner", "bookkeeper"] as const;

const bodySchema = z.object({
  carrier: z.string().refine(isRecordId, "Choose one carrier's discrepancies"),
  ids: z.array(z.string().refine(isRecordId, "That discrepancy is not in this workspace")).min(1, "Choose at least one discrepancy").max(200),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("discrepancy_report", roles);
  if (auth instanceof NextResponse) return auth;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Check the request and try again" }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    const list = await listDiscrepancies(tenantId, { ids: body.data.ids });
    const items = letterItems(list.items, body.data.carrier, body.data.ids);
    if (!items.length) return NextResponse.json({ error: "None of those discrepancies can go on a letter to that carrier." }, { status: 404 });
    const totalCents = items.reduce((sum, item) => sum + item.owedCents, 0);
    await audit({
      actorType: "tenant",
      actorId: userId,
      action: "tenant.dispute_letter_generated",
      targetType: "carrier",
      targetId: body.data.carrier,
      metadata: { tenantId, carrierName: items[0].carrierName, discrepancyIds: items.map((item) => item.id), totalCents },
      request,
    });
    return NextResponse.json({ ok: true, items: items.length, totalCents });
  } catch (error) {
    console.error("[discrepancies] letter", error);
    return NextResponse.json({ error: "Could not record the letter" }, { status: 500 });
  }
}
