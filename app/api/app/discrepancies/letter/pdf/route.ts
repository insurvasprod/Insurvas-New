import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { buildDisputeLetterPdf, getDisputeLetter } from "@/lib/discrepancies/letter";
import { isRecordId } from "@/lib/ledger/statementConstants";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary (LA-4.5): the dispute letter as a PDF to download (the spec's optional pdf-lib
 * letter). POST `{ carrier, ids, to }` builds it from the same gathered letter as the printed page
 * (lib/discrepancies/letter.ts), so the rows and the total are the page's, and records it in the
 * audit log once per download, as Print does. The recipient travels in the body, never the URL.
 *
 * Reading, as printing is: a read-only account may download it. Owner and bookkeeper only.
 */
const roles = ["owner", "bookkeeper"] as const;

const bodySchema = z.object({
  carrier: z.string().refine(isRecordId, "Choose one carrier's discrepancies"),
  ids: z.array(z.string().refine(isRecordId, "That discrepancy is not in this workspace")).min(1, "Choose at least one discrepancy").max(200),
  to: z.string().max(600).optional(),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("discrepancy_report", roles);
  if (auth instanceof NextResponse) return auth;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Check the request and try again" }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    const letter = await getDisputeLetter(tenantId, userId, body.data.carrier, body.data.ids);
    if (!letter) return NextResponse.json({ error: "None of those discrepancies can go on a letter to that carrier." }, { status: 404 });
    const bytes = await buildDisputeLetterPdf(letter, body.data.to ?? letter.savedRecipient ?? "");
    await audit({
      actorType: "tenant",
      actorId: userId,
      action: "tenant.dispute_letter_generated",
      targetType: "carrier",
      targetId: letter.carrierId,
      metadata: { tenantId, carrierName: letter.carrierName, discrepancyIds: letter.items.map((item) => item.id), totalCents: letter.totalCents, format: "pdf" },
      request,
    });
    const name = `commission-dispute-${letter.carrierName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${letter.today}.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[discrepancies] letter pdf", error);
    return NextResponse.json({ error: "Could not build the letter PDF" }, { status: 500 });
  }
}
