import { NextResponse } from "next/server";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { roleCanViewCommission } from "@/lib/tenantAuth/permissions";
import { getCommissionLedger } from "@/lib/ledger/service";
import { reconcileStatements, statementTotals } from "@/lib/ledger/statementMatch";
import { getStatementLedger } from "@/lib/ledger/statementService";

/**
 * Money boundary for the agent plane: the commission ledger.
 *
 * Every entry is derived — the book of business multiplied by the carrier library's commission
 * schedules and advance rules (lib/ledger/compute.ts, which resolves each figure with
 * resolveCommissionRate and commissionCentsFromSchedule; never a literal percentage). A policy whose
 * carrier, product, contract level or rate is missing from the library is returned under `gaps`
 * with the reason, not priced.
 *
 * Producers are scoped to their own policies with roleCanViewCommission (LA-0.2 criterion 3);
 * owners and bookkeepers see every policy. Assistants and setters never reach this route.
 */
export async function GET() {
  const auth = await requireFeatureRole("commission_ledger", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;

  try {
    const canView = (producerUserId: string | undefined) => roleCanViewCommission(auth.context.role, auth.context.userId, producerUserId);
    const [ledger, statements] = await Promise.all([
      getCommissionLedger({ tenantId: auth.context.tenantId, canView }),
      // What carriers reported: accepted statement lines, scoped by the same rule (lib/ledger/statementService.ts).
      getStatementLedger({ tenantId: auth.context.tenantId, canView }),
    ]);
    return NextResponse.json(
      {
        ok: true,
        readOnly: auth.entitlement.access === "read_only",
        entries: ledger.entries,
        totals: ledger.totals,
        gaps: ledger.gaps,
        policiesRead: ledger.policiesRead,
        statements: {
          available: statements.available,
          entries: statements.entries,
          totals: statementTotals(statements.entries),
          reconciliation: reconcileStatements(ledger.entries, statements.entries, new Set(ledger.entries.map((entry) => entry.policyId))),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[ledger] could not derive the commission ledger", error);
    return NextResponse.json({ error: "Could not load the commission ledger" }, { status: 500 });
  }
}
