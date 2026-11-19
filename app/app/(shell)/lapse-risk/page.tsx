import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

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
import { StreamSection } from "@/components/ui/stream-section";

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

  // Round 7 (owner pick 4·A, 2026-11-10; docs/la4/mockups-r7/retention.html): signals are cases. Once the ladder's
  // tables exist this address opens Cases; a signal a person heard is a New case ("Opened by a person"). The old
  // board stays reachable only while it still holds signals recorded before (nothing recorded is hidden).
  // Which page this is (or a redirect) is the gate: it is decided before the frame; the lists stream in under it.
  const ladder = await ladderAvailable(guard.context.tenantId);
  if (view === "signals") {
    const legacyRead = getLapseRisk(guard.context);
    if (ladder && (await legacyRead).policies.length === 0) redirect("/app/retention?step=paperwork&by=person");
    return (
      <DataInPage step="needs-you" title="Lapse risk" tabs={tabs()} actions={readOnly ? undefined : <Suspense fallback={null}><RecordSignal read={legacyRead} /></Suspense>}>
        <StreamSection shape="strip+table"><Signals read={legacyRead} readOnly={readOnly} /></StreamSection>
      </DataInPage>
    );
  }

  // The call list became Retention › Cases (owner 2026-11-05: Retention is what the files say), once its
  // tables exist; the recorded signals above stay here.
  if (ladder) redirect("/app/retention");
  const reads: Calls = scopeFor(guard.context).then((scope) => {
    const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope };
    return Promise.all([loadBoard(viewer), loadSaveRates(viewer)] as const);
  });
  return (
    <DataInPage step="needs-you" title="Lapse risk" tabs={<Suspense fallback={tabs()}><CallTabs read={reads} tabs={tabs} /></Suspense>}>
      <StreamSection shape="table"><Calls read={reads} readOnly={readOnly} /></StreamSection>
    </DataInPage>
  );
}

type Legacy = ReturnType<typeof getLapseRisk>;
type Calls = Promise<[Awaited<ReturnType<typeof loadBoard>>, Awaited<ReturnType<typeof loadSaveRates>>]>;

/** Record a signal, once there are signals on the board (an empty board says how). */
async function RecordSignal({ read }: { read: Legacy }) {
  const legacy = await read;
  return legacy.policies.length === 0 ? null : <RecordLapseSignal />;
}

async function Signals({ read, readOnly }: { read: Legacy; readOnly: boolean }) {
  const legacy = await read;
  return legacy.policies.length === 0
    ? <LapseRiskEmpty notice={legacy.storage === "pending" ? LAPSE_SCHEMA_PENDING_MESSAGE : undefined} framed />
    : <LapseRiskBoard policies={legacy.policies} totals={legacy.totals} readOnly={readOnly} framed />;
}

async function CallTabs({ read, tabs }: { read: Calls; tabs: (count?: number) => ReactNode }) {
  const [board] = await read;
  return tabs(board.rows.length);
}

async function Calls({ read, readOnly }: { read: Calls; readOnly: boolean }) {
  const [board, rates] = await read;
  return (
    <div className="m-stagger flex flex-col gap-6">
      <RetentionBoard rows={board.rows} rates={rates.available ? { calls: rates.calls, byReason: rates.byReason, byCarrier: rates.byCarrier, byAgent: rates.byAgent } : null} readOnly={readOnly} />
    </div>
  );
}
