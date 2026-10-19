import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { readStatement } from "@/lib/agency/ledgerStore";
import { buildStatement } from "@/lib/agency/statementCore";
import { buildStatementPdf } from "@/lib/agency/statementPdf";
import { NO_STORE, refuseManagerMoney } from "@/lib/agency/http";

/**
 * AG-1.8 · one producer statement, generated from the ledger at request time (it always reconciles). The producer
 * opens his own without asking anyone; the owner, an admin and the bookkeeper open any. A producer asking for
 * another producer's statement gets 404 — he cannot learn it exists. ?format=pdf downloads the PDF.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireFeatureRole("producer_payouts", ["owner", "bookkeeper", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const { runId } = await params;
  if (!z.string().uuid().safeParse(runId).success) return NextResponse.json({ error: "That statement could not be found." }, { status: 404 });
  const data = await readStatement(auth.context.tenantId, runId);
  if (!data) return NextResponse.json({ error: "That statement could not be found." }, { status: 404 });
  if (auth.context.role === "producer" && data.run.producerUserId !== auth.context.userId) {
    return NextResponse.json({ error: "That statement could not be found." }, { status: 404 });
  }
  const refused = refuseManagerMoney(auth.context, data.run.producerUserId);
  if (refused) return refused;
  const statement = buildStatement(data.before, data.during, "reported");
  if (new URL(request.url).searchParams.get("format") === "pdf") {
    const bytes = await buildStatementPdf({ producer: data.producer, agency: data.agency, periodStart: data.run.periodStart, periodEnd: data.run.periodEnd, paidOn: data.run.paidOn, method: data.run.method, reference: data.run.reference, withheldCents: data.run.withheldCents, decision: data.run.decision, decisionReason: data.run.decisionReason }, statement);
    return new NextResponse(Buffer.from(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="statement-${data.run.periodStart}-${data.run.periodEnd}.pdf"`, ...NO_STORE },
    });
  }
  return NextResponse.json({ run: data.run, producer: data.producer, agency: data.agency, statement }, { headers: NO_STORE });
}
