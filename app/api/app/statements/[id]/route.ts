import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { STATEMENT_SCHEMA_PENDING_MESSAGE } from "@/lib/ledger/statementConstants";
import { badRequest, isRecordId, statementFailure, statementVoidSchema } from "@/lib/ledger/statementHttp";
import { getStatementDetail, voidStatement } from "@/lib/ledger/statementService";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary: one carrier statement. GET returns it with every line (verbatim) and its live
 * match. PATCH `{ action: "void", reason }` voids it: its accepted lines leave the ledger, and the
 * statement, its lines, its matches and the reason all stay. Statements are never deleted.
 */
const roles = ["owner", "bookkeeper"] as const;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isRecordId(id)) return NextResponse.json({ error: "That statement is not in this workspace" }, { status: 404 });
  try {
    const result = await getStatementDetail(auth.context.tenantId, id);
    if (!result.available) return NextResponse.json({ ok: true, available: false, message: STATEMENT_SCHEMA_PENDING_MESSAGE, statement: null, lines: [] });
    if (!result.detail) return NextResponse.json({ error: "That statement is not in this workspace" }, { status: 404 });
    return NextResponse.json(
      { ok: true, available: true, statement: result.detail.statement, lines: result.detail.lines },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return statementFailure(error, "Could not load the statement");
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isRecordId(id)) return NextResponse.json({ error: "That statement is not in this workspace" }, { status: 404 });
  const body = statementVoidSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest(body.error);

  try {
    const voided = await voidStatement(auth.context.tenantId, auth.context.userId, id, body.data.reason);
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.commission_statement_voided",
      targetType: "tenant_commission_statement",
      targetId: id,
      reason: body.data.reason,
      metadata: { tenantId: auth.context.tenantId, carrierId: voided.carrier_id, periodStart: voided.period_start, periodEnd: voided.period_end, fileName: voided.original_filename },
      request,
    });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return statementFailure(error, "Could not void the statement");
  }
}
