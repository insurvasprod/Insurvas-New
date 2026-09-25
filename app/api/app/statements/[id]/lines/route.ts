import { NextResponse, type NextRequest } from "next/server";

import { auditMany } from "@/lib/audit/log";
import type { AuditAction } from "@/lib/audit/actions";
import { badRequest, isRecordId, statementDecisionSchema, statementFailure } from "@/lib/ledger/statementHttp";
import { decideStatementLines } from "@/lib/ledger/statementService";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary: a person deciding statement lines. This is the only way a statement line reaches
 * the ledger — "who accepted the match" is the caller, recorded on the match and in one audit row
 * per line:
 *
 *   accept           the import's exact-match proposal, as proposed
 *   reject           the proposal is wrong; the line waits, unmatched
 *   match            this line is that policy, chosen by hand (accepted as it is chosen)
 *   leave_unmatched  this line matches no policy on purpose (a total row, a fee); it stays visible
 *
 * All decisions in one request apply together or not at all.
 */
const roles = ["owner", "bookkeeper"] as const;

const ACTION: Record<"accept" | "reject" | "match" | "leave_unmatched", AuditAction> = {
  accept: "tenant.statement_match_accepted",
  reject: "tenant.statement_match_rejected",
  match: "tenant.statement_line_matched",
  leave_unmatched: "tenant.statement_line_left_unmatched",
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isRecordId(id)) return NextResponse.json({ error: "That statement is not in this workspace" }, { status: 404 });
  const body = statementDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest(body.error);

  try {
    const result = await decideStatementLines(auth.context.tenantId, auth.context.userId, id, body.data.decisions);
    await auditMany(result.lines.map((line) => ({
      actorType: "tenant" as const,
      actorId: auth.context.userId,
      action: ACTION[line.action],
      targetType: "tenant_commission_statement_line",
      targetId: line.line_id,
      metadata: { tenantId: auth.context.tenantId, statementId: id, lineNumber: line.line_number, policyId: line.policy_id, proposedPolicyId: line.proposed_policy_id },
      request,
    })));
    return NextResponse.json({ ok: true, accepted: result.accepted, rejected: result.rejected, matched: result.matched, leftUnmatched: result.left_unmatched, status: result.status });
  } catch (error) {
    return statementFailure(error, "Could not record the decision");
  }
}
