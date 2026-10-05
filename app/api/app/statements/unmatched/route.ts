import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { STATEMENT_SCHEMA_PENDING_MESSAGE } from "@/lib/ledger/statementConstants";
import { badRequest, rematchSchema, statementFailure } from "@/lib/ledger/statementHttp";
import { listUnmatchedLines, rematchStatementLines } from "@/lib/ledger/statementService";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary (LA-4.3): the unmatched queue across every statement that is not voided.
 *
 * GET lists each line still without a match. POST `{ action: "rematch" }` proposes matches again
 * for all of them against the book as it is now (policy number first, then insured name + carrier).
 * Proposals only: a person still accepts each one on its statement. Lines a person left unmatched
 * on purpose are not touched.
 *
 * Owner and bookkeeper only, the two roles that hold `statements.view`.
 */
const roles = ["owner", "bookkeeper"] as const;

export async function GET() {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await listUnmatchedLines(auth.context.tenantId);
    return NextResponse.json(
      { ok: true, available: result.available, message: result.available ? null : STATEMENT_SCHEMA_PENDING_MESSAGE, lines: result.lines },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return statementFailure(error, "Could not load the unmatched lines");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = rematchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest(body.error);
  try {
    const result = await rematchStatementLines(auth.context.tenantId, auth.context.userId);
    if (result.proposed > 0) {
      await audit({
        actorType: "tenant",
        actorId: auth.context.userId,
        action: "tenant.statement_lines_rematched",
        targetType: "tenant",
        targetId: auth.context.tenantId,
        metadata: { tenantId: auth.context.tenantId, proposedMatches: result.proposed, statements: result.statements, lines: result.lines.map((line) => ({ lineId: line.line_id, statementId: line.statement_id, lineNumber: line.line_number, policyId: line.policy_id, method: line.method })) },
        request,
      });
    }
    return NextResponse.json({ ok: true, proposed: result.proposed, statements: result.statements });
  } catch (error) {
    return statementFailure(error, "Could not re-match the lines");
  }
}
