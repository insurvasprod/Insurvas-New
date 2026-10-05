import { NextResponse, type NextRequest } from "next/server";

import { audit, auditMany } from "@/lib/audit/log";
import type { AuditAction } from "@/lib/audit/actions";
import { badRequest, isRecordId, manualLinesSchema, rematchSchema, statementDecisionSchema, statementFailure } from "@/lib/ledger/statementHttp";
import { addManualStatementLines, decideStatementLines, rematchStatementLines } from "@/lib/ledger/statementService";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary: the lines of one statement.
 *
 * `{ decisions }`: a person deciding lines. This is the only way a statement line reaches the
 * ledger — "who accepted the match" is the caller, recorded on the match and in one audit row per
 * line:
 *
 *   accept           the import's proposal (exact, or by name), as proposed
 *   reject           the proposal is wrong; the line waits, unmatched
 *   match            this line is that policy, chosen by hand (accepted as it is chosen)
 *   leave_unmatched  this line matches no policy on purpose (a total row, a fee); it stays visible
 *
 * All decisions in one request apply together or not at all.
 *
 * `{ action: "add_manual_lines", lines }` (LA-4.2): the lines typed from a PDF statement, once,
 * read and matched by the same rules as a file's lines.
 *
 * `{ action: "rematch" }` (LA-4.3): propose matches again for this statement's unmatched lines
 * against the book as it is now. Proposals only.
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
  const raw = await request.json().catch(() => null);
  const tenantId = auth.context.tenantId;
  const actorId = auth.context.userId;

  try {
    if (raw && typeof raw === "object" && (raw as { action?: unknown }).action === "add_manual_lines") {
      const body = manualLinesSchema.safeParse(raw);
      if (!body.success) return badRequest(body.error);
      const result = await addManualStatementLines(tenantId, actorId, id, body.data.lines);
      await audit({
        actorType: "tenant", actorId, action: "tenant.statement_lines_entered_manually",
        targetType: "tenant_commission_statement", targetId: id,
        metadata: { tenantId, lines: result.lines, proposedMatches: result.proposed, unreadableLines: result.errors },
        request,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (raw && typeof raw === "object" && (raw as { action?: unknown }).action === "rematch") {
      const body = rematchSchema.safeParse(raw);
      if (!body.success) return badRequest(body.error);
      const result = await rematchStatementLines(tenantId, actorId, id);
      if (result.proposed > 0) {
        await audit({
          actorType: "tenant", actorId, action: "tenant.statement_lines_rematched",
          targetType: "tenant_commission_statement", targetId: id,
          metadata: { tenantId, proposedMatches: result.proposed, lines: result.lines.map((line) => ({ lineId: line.line_id, lineNumber: line.line_number, policyId: line.policy_id, method: line.method })) },
          request,
        });
      }
      return NextResponse.json({ ok: true, proposed: result.proposed });
    }

    const body = statementDecisionSchema.safeParse(raw);
    if (!body.success) return badRequest(body.error);
    const result = await decideStatementLines(tenantId, actorId, id, body.data.decisions);
    await auditMany(result.lines.map((line) => ({
      actorType: "tenant" as const,
      actorId,
      action: ACTION[line.action],
      targetType: "tenant_commission_statement_line",
      targetId: line.line_id,
      metadata: { tenantId, statementId: id, lineNumber: line.line_number, policyId: line.policy_id, proposedPolicyId: line.proposed_policy_id },
      request,
    })));
    return NextResponse.json({ ok: true, accepted: result.accepted, rejected: result.rejected, matched: result.matched, leftUnmatched: result.left_unmatched, status: result.status });
  } catch (error) {
    return statementFailure(error, "Could not record the change");
  }
}
