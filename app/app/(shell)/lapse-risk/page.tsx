import { guardPage } from "@/lib/entitlements/guardPage";
import { getLapseRisk, LAPSE_SCHEMA_PENDING_MESSAGE } from "@/lib/lapseRisk/service";
import { loadBoard, loadSaveRates } from "@/lib/ingestion/retentionStore";
import { ViewTabs } from "@/components/app/book-of-business-views";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { LapseRiskBoard } from "@/components/app/lapse-risk-board";
import { LapseRiskEmpty } from "@/components/app/lapse-risk-empty";
import { RetentionBoard } from "@/components/app/retention-board";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Retention › Lapse risk. Two views:
 *   · Call list (LA-4.16, the default): who to phone today, from the carriers' own files — the
 *     reason, days left before the carrier closes the policy, the advance at stake, the last call.
 *   · Recorded signals (the earlier board): lapse signals a person or a call recorded.
 *
 * Gated on `chargeback_radar`; owner and producer (a producer's call list holds their own policies).
 * Opening the page writes nothing.
 */
export default async function LapseRiskPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const guard = await guardPage("chargeback_radar");

  if (!guard.entitled) {
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Lapse risk"
        description="Policies with a recorded reason to lapse, and the commission each lapse would cost."
      />
    );
  }

  if (!["owner", "producer"].includes(guard.role)) {
    return <RoleGateNotice featureLabel="Lapse risk" detail="Only owners and producers can view retention risk and commission exposure." />;
  }

  const { view } = await searchParams;
  const readOnly = guard.entitlement.access === "read_only";
  const tabs = (count?: number) => (
    <ViewTabs
      label="Lapse risk views"
      active={view === "signals" ? "signals" : "calls"}
      tabs={[
        { key: "calls", label: "Call list", count, href: "/app/lapse-risk" },
        { key: "signals", label: "Recorded signals", href: "/app/lapse-risk?view=signals" },
      ]}
    />
  );

  if (view === "signals") {
    const legacy = await getLapseRisk(guard.context);
    if (legacy.policies.length === 0) return <LapseRiskEmpty notice={legacy.storage === "pending" ? LAPSE_SCHEMA_PENDING_MESSAGE : undefined} tabs={tabs()} />;
    return <LapseRiskBoard policies={legacy.policies} totals={legacy.totals} readOnly={readOnly} tabs={tabs()} />;
  }

  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role };
  const [board, rates] = await Promise.all([loadBoard(viewer), loadSaveRates(viewer)]);
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Lapse risk" description="Who to call today to keep a policy alive, in order: the soonest deadline first, then the most money." />
      {tabs(board.rows.length)}
      <RetentionBoard rows={board.rows} rates={rates.available ? { calls: rates.calls, byReason: rates.byReason, byCarrier: rates.byCarrier, byAgent: rates.byAgent } : null} readOnly={readOnly} />
    </div>
  );
}
