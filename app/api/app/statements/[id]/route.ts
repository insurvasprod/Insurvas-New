import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { STATEMENT_SCHEMA_PENDING_MESSAGE } from "@/lib/ledger/statementConstants";
import { badRequest, isRecordId, statementFailure, statementReprocessSchema, statementVoidSchema } from "@/lib/ledger/statementHttp";
import { getStatementDetail, reprocessStatement, voidStatement } from "@/lib/ledger/statementService";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary: one carrier statement. GET returns it with every line (verbatim) and its live
 * match. PATCH `{ action: "void", reason }` voids it: its accepted lines leave the ledger, and the
 * statement, its lines, its matches and the reason all stay. Statements are never deleted.
 *
 * PATCH `{ action: "reprocess", mapping? }` (LA-4.3) re-reads the statement from its stored
 * original, with new column choices or the ones it was imported with: a new statement is written
 * with fresh proposals, and this one is voided and kept, in one transaction.
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
  const raw = await request.json().catch(() => null);

  if (raw && typeof raw === "object" && (raw as { action?: unknown }).action === "reprocess") {
    const parsed = statementReprocessSchema.safeParse(raw);
    if (!parsed.success) return badRequest(parsed.error);
    try {
      const result = await reprocessStatement(auth.context.tenantId, auth.context.userId, id, parsed.data.mapping);
      await audit({
        actorType: "tenant",
        actorId: auth.context.userId,
        action: "tenant.commission_statement_reprocessed",
        targetType: "tenant_commission_statement",
        targetId: result.statementId,
        metadata: { tenantId: auth.context.tenantId, replacedStatementId: id, fileKind: result.fileKind, fileSha256: result.sha256, lines: result.lines, proposedMatches: result.proposed, unreadableLines: result.errors, mapping: result.mapping },
        request,
      });
      return NextResponse.json({ ok: true, id: result.statementId, replaced: id, lines: result.lines, proposed: result.proposed });
    } catch (error) {
      return statementFailure(error, "Could not re-process the statement");
    }
  }

  const body = statementVoidSchema.safeParse(raw);
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
