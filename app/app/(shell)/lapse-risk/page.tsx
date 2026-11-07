import { redirect } from "next/navigation";

import { scopeFor } from "@/lib/agency/visibility";
import { ladderAvailable } from "@/lib/retention/cases/store";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { getLapseRisk, LAPSE_SCHEMA_PENDING_MESSAGE } from "@/lib/lapseRisk/service";
import { loadBoard, loadSaveRates } from "@/lib/ingestion/retentionStore";
import { ViewTabs } from "@/components/app/book-of-business-views";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { LapseRiskBoard } from "@/components/app/lapse-risk-board";
import { LapseRiskEmpty } from "@/components/app/lapse-risk-empty";
import { RetentionBoard } from "@/components/app/retention-board";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DataInPage } from "@/components/app/data-in/data-in-page";
import { RecordLapseSignal } from "@/components/app/record-lapse-signal";

/**
 * Book of business › Needs you › Lapse risk (owner 2026-11-02: it was in the Book group; it is what the
 * carriers' files already show — LA-4.16 — so it sits with Book of business, never beside a prediction). Two views:
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

  if (!actAsPage(guard, ["owner", "producer", "retention"])) {
    return <RoleGateNotice featureLabel="Lapse risk" detail="Only owners, producers and retention reps can view retention risk and the advance at risk." />;
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
    return (
      <DataInPage step="needs-you" title="Lapse risk" lead={tabs()} actions={readOnly || legacy.policies.length === 0 ? undefined : <RecordLapseSignal />}>
        {legacy.policies.length === 0
          ? <LapseRiskEmpty notice={legacy.storage === "pending" ? LAPSE_SCHEMA_PENDING_MESSAGE : undefined} framed />
          : <LapseRiskBoard policies={legacy.policies} totals={legacy.totals} readOnly={readOnly} framed />}
      </DataInPage>
    );
  }

  // The call list became Retention › Cases (owner 2026-11-05: Retention is what the files say), once its
  // tables exist; the recorded signals above stay here.
  if (await ladderAvailable(guard.context.tenantId)) redirect("/app/retention");
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const [board, rates] = await Promise.all([loadBoard(viewer), loadSaveRates(viewer)]);
  return (
    <DataInPage step="needs-you" title="Lapse risk" lead={tabs(board.rows.length)}>
      <div className="m-stagger flex flex-col gap-6">
        <RetentionBoard rows={board.rows} rates={rates.available ? { calls: rates.calls, byReason: rates.byReason, byCarrier: rates.byCarrier, byAgent: rates.byAgent } : null} readOnly={readOnly} />
      </div>
    </DataInPage>
  );
}
