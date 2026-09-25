import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { STATEMENT_SCHEMA_PENDING_MESSAGE } from "@/lib/ledger/statementConstants";
import { badRequest, statementFailure, statementImportSchema, toImportInput } from "@/lib/ledger/statementHttp";
import { importStatement, listStatements } from "@/lib/ledger/statementService";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary for the agent plane: carrier commission statements.
 *
 * GET lists every statement imported, with its line counts. POST imports one: the file is parsed
 * with the carrier's column mapping, every row is kept verbatim, exact matches (policy number +
 * carrier) are PROPOSED, and nothing posts to the ledger until a person accepts a match
 * (statements/[id]/lines). The same file for the same carrier and period is refused while the first
 * import stands.
 *
 * Owner and bookkeeper only — the two roles that hold `statements.view`. A producer reads statement
 * entries for their own policies on the ledger, never the statements themselves.
 */
const roles = ["owner", "bookkeeper"] as const;

export async function GET() {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await listStatements(auth.context.tenantId);
    return NextResponse.json(
      { ok: true, available: result.available, message: result.available ? null : STATEMENT_SCHEMA_PENDING_MESSAGE, statements: result.statements },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return statementFailure(error, "Could not load statements");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = statementImportSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest(body.error);

  try {
    const result = await importStatement(auth.context.tenantId, auth.context.userId, toImportInput(body.data));
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.commission_statement_imported",
      targetType: "tenant_commission_statement",
      targetId: result.statementId,
      metadata: {
        tenantId: auth.context.tenantId,
        carrierId: body.data.carrier_id,
        periodStart: body.data.period_start,
        periodEnd: body.data.period_end,
        fileName: body.data.file_name,
        fileSha256: result.sha256,
        lines: result.lines,
        proposedMatches: result.proposed,
        unreadableLines: result.errors,
      },
      request,
    });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.statement_mapping_saved",
      targetType: "tenant_statement_column_mapping",
      targetId: body.data.carrier_id,
      metadata: { tenantId: auth.context.tenantId, carrierId: body.data.carrier_id, mapping: result.mapping },
      request,
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return statementFailure(error, "Could not import the statement");
  }
}
