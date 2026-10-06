import Link from "next/link";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DiscrepanciesWorkspace, type DiscrepancyRow } from "@/components/app/discrepancies-workspace";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { DISCREPANCY_KIND_LABELS } from "@/lib/discrepancies/compute";
import { DISCREPANCY_SCHEMA_PENDING_MESSAGE, listDiscrepancies, owedToYou } from "@/lib/discrepancies/service";
import { statementMoney } from "@/lib/ledger/statementConstants";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

/**
 * Book of Business › Discrepancies (LA-4.5): "You appear to be owed $X".
 *
 * Every figure is a comparison the agent can follow — what the contract expects against what the
 * carrier reported on its accepted statement lines — and each finding names its kind: never paid,
 * short-paid, paid at the wrong rate, charged back twice, or charged back while in force. The page
 * only reads: the findings are recomputed after each change to their facts (user decision
 * 2026-10-06, option a), so opening it writes nothing, for a read-only account or anyone else.
 *
 * Owner and bookkeeper (`statements.view`), as the menu item. A read-only account reads it and can
 * print a letter, but cannot record decisions.
 */
export default async function DiscrepanciesPage() {
  const guard = await guardPage("discrepancy_report");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Discrepancies" description="What each carrier paid against what your contract says it owes, with a dispute letter for each one." />;
  }
  if (!hasTenantPermission(guard.role, "statements.view")) {
    return <RoleGateNotice featureLabel="Discrepancies" detail="Discrepancies are worked by the account owner or a bookkeeper." />;
  }

  const tenantId = guard.context.tenantId;
  // Reading only (LA-4.5, option a): the findings are recomputed after every change to their facts
  // (statements, policies, contracts, schedules), never because someone opened this page.
  const [list, owed] = await Promise.all([listDiscrepancies(tenantId), owedToYou(tenantId)]);
  const readOnly = guard.entitlement.access === "read_only";
  const chargebacks = owed.byKind.duplicate_chargeback.cents + owed.byKind.unexpected_chargeback.cents;
  const chargebackCount = owed.byKind.duplicate_chargeback.count + owed.byKind.unexpected_chargeback.count;
  const rate = owed.byKind.short_paid.cents + owed.byKind.mis_rated.cents;
  const rateCount = owed.byKind.short_paid.count + owed.byKind.mis_rated.count;

  const rows: DiscrepancyRow[] = list.items.map((item) => ({
    id: item.id, kind: item.kind, status: item.status, owedCents: item.owedCents, policyNumber: item.policyNumber, insuredName: item.insuredName,
    carrierId: item.carrierId, carrierName: item.carrierName, periodStart: item.periodStart, periodEnd: item.periodEnd,
    expectedCents: item.detail?.expectedCents ?? 0, receivedCents: item.detail?.receivedCents ?? 0, explanation: item.detail?.explanation ?? "",
    note: item.note, statusChangedByName: item.statusChangedByName, statusChangedAt: item.statusChangedAt, history: item.history,
  }));

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="Discrepancies"
        description="What each carrier paid against what your contract says it owes."
        actions={<Button asChild type="button" variant="outline"><Link href="/app/statements">Statements</Link></Button>}
      />

      {!list.available && (
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{DISCREPANCY_SCHEMA_PENDING_MESSAGE}</div>
      )}

      {list.available && (
        <StatStrip label="Owed to you">
          <StatTile label="You appear to be owed" value={statementMoney(owed.totalCents)} valueTone={owed.totalCents > 0 ? "warning" : undefined} footnote={`${owed.count.toLocaleString("en-US")} open or disputed`} />
          <StatTile label={DISCREPANCY_KIND_LABELS.never_paid.label} value={statementMoney(owed.byKind.never_paid.cents)} footnote={`${owed.byKind.never_paid.count.toLocaleString("en-US")} ${DISCREPANCY_KIND_LABELS.never_paid.plural}`} />
          <StatTile label="Short or wrong rate" value={statementMoney(rate)} footnote={`${rateCount.toLocaleString("en-US")} paid less than owed`} />
          <StatTile label="Chargebacks" value={statementMoney(chargebacks)} footnote={`${chargebackCount.toLocaleString("en-US")} charged back twice or while active`} />
        </StatStrip>
      )}

      {list.available && (
        <DiscrepanciesWorkspace
          items={rows}
          canWrite={!readOnly}
          writeBlockedReason={readOnly ? "Reading and printing remain available; decisions are paused while the account is read-only." : null}
        />
      )}
    </div>
  );
}
