import { guardPage } from "@/lib/entitlements/guardPage";
import { getLapseRisk, LAPSE_SCHEMA_PENDING_MESSAGE } from "@/lib/lapseRisk/service";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { LapseRiskBoard } from "@/components/app/lapse-risk-board";
import { LapseRiskEmpty } from "@/components/app/lapse-risk-empty";
import { RoleGateNotice } from "@/components/app/role-gate-notice";

/**
 * Gated on `chargeback_radar`, which only plan_c grants — so this is the page that demonstrates
 * the route guard doing something. A plan_a tenant pasting this URL gets an upgrade prompt
 * rather than a broken screen, and while the feature is switched off platform-wide every tenant
 * gets the platform notice instead (guard.killed), before anything below is read.
 *
 * A policy is listed only while it carries an open lapse signal — the reason is the risk
 * (lib/lapseRisk/model.ts). With none, the board's own empty state, unchanged.
 */
export default async function LapseRiskPage() {
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

  const view = await getLapseRisk(guard.context);

  if (view.policies.length === 0) {
    return <LapseRiskEmpty notice={view.storage === "pending" ? LAPSE_SCHEMA_PENDING_MESSAGE : undefined} />;
  }

  return <LapseRiskBoard policies={view.policies} totals={view.totals} readOnly={guard.entitlement.access === "read_only"} />;
}
