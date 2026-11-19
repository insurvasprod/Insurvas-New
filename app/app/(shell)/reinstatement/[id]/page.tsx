import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { personName } from "@/lib/format/personName";
import { fileDay } from "@/lib/ingestion/constants";
import { CASE_STATUS_LABELS, OPEN_CASE_STATUSES, type Urgency } from "@/lib/retention/reinstatement";
import { loadCase, REINSTATEMENT_PENDING_MESSAGE } from "@/lib/retention/reinstatementStore";
import { openLadderCaseId } from "@/lib/retention/cases/store";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Await, RecordTitle, RetentionPage, retentionTrail } from "@/components/app/retention/retention-page";
import { CaseActions, CaseComparison, CaseNeedsForm, CaseNoteForm } from "@/components/app/retention/reinstatement-case";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Retention › Reinstatement › a case (LA-5.6, direction RiA 2026-11-05; was the CaseDialog pop-up on the list).
 * The title is the client with the countdown, one line of facts, the next step and More; the tabs are
 * Reinstate or sell new, What the carrier needs and Notes. The same gates, viewer and scope as the list page;
 * a closed case (or a read-only plan) shows the same tabs with nothing to press.
 */
type Tab = "compare" | "needs" | "notes";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNTDOWN_TONE: Record<Urgency, StatusTone> = { pinned: "danger", red: "danger", amber: "warning", plain: "neutral", no_window: "neutral" };

export default async function ReinstatementCasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("winback");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Reinstatement" description="Lapsed policies the carrier will still take back, and former clients worth winning back." />;
  }
  if (!actAsPage(guard, ["owner", "producer", "retention"])) {
    return <RoleGateNotice featureLabel="Reinstatement" detail="Only owners, producers and retention reps can work reinstatement cases." />;
  }
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const asked = (await searchParams).tab;
  const tab: Tab = asked === "needs" || asked === "notes" ? asked : "compare";
  const readOnly = guard.entitlement.access === "read_only";
  // Frame first (UI-CONSISTENCY §7a): the trail, the tabs and the step draw at once and the client's name waits in a
  // title-shaped placeholder. The read starts here; an open case still moves to its Retention case, from the step.
  const read = scopeFor(guard.context).then(async (scope) => {
    const loaded = await loadCase({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope }, id);
    if (!loaded.available) return { pending: true as const, row: null, ladderCase: null };
    const row = loaded.row;
    // One place to work a lapse (critique D1–D3): an open reinstatement is worked on its Retention case, step 3,
    // where the trail leads back to Cases. A closed one (or one with no ladder case) still reads here.
    const ladderCase = row && OPEN_CASE_STATUSES.includes(row.status) ? await openLadderCaseId(guard.context.tenantId, row.carrierId, row.policyNumber) : null;
    return { pending: false as const, row, ladderCase };
  });
  const nameOf = (row: CaseRow) => (row.clientName ? personName(row.clientName) : row.policyNumber);
  const base = `/app/reinstatement/${id}`;
  const tabsOf = (label: string) => (
    <ViewTabs label={label} value={tab} tabs={[
      { key: "compare", label: "Reinstate or sell new", href: base },
      { key: "needs", label: "What the carrier needs", href: `${base}?tab=needs` },
      { key: "notes", label: "Notes", href: `${base}?tab=notes` },
    ]} />
  );
  const chipOf = (row: CaseRow) => (!OPEN_CASE_STATUSES.includes(row.status) ? (
    <StatusChip tone={row.status === "reinstated" ? "good" : row.status === "expired" ? "danger" : "neutral"}>{CASE_STATUS_LABELS[row.status]}</StatusChip>
  ) : row.deadline === null || row.daysRemaining === null ? (
    <StatusChip tone="neutral">No carrier window</StatusChip>
  ) : (
    <StatusChip tone={COUNTDOWN_TONE[row.urgency]}>
      {row.daysRemaining <= 0 ? `Closes today · ${fileDay(row.deadline)}` : `${row.daysRemaining} ${row.daysRemaining === 1 ? "day" : "days"} left · closes ${fileDay(row.deadline)}`}
    </StatusChip>
  ));
  // A record shown here (not moved on, not missing): what the title line and the step draw from.
  const shown = (value: Awaited<typeof read>) => (value.row && !value.ladderCase ? value.row : null);

  return (
    <RetentionPage
      step="reinstatement"
      title={<RecordTitle read={read} name={(value) => (value.pending ? "Reinstatement case" : value.row ? nameOf(value.row) : null)} />}
      chip={<Suspense fallback={null}><Await read={read}>{(value) => { const row = shown(value); return row ? chipOf(row) : null; }}</Await></Suspense>}
      breadcrumbs={retentionTrail("reinstatement", "Case")}
      tabs={<Suspense fallback={tabsOf("Case")}><Await read={read}>{(value) => { const row = shown(value); return value.pending ? null : tabsOf(row ? `Case of ${nameOf(row)}` : "Case"); }}</Await></Suspense>}
      actions={<Suspense fallback={null}><Await read={read}>{(value) => { const row = shown(value); const locked = !row || readOnly || !OPEN_CASE_STATUSES.includes(row.status); return locked ? null : <CaseActions row={row} />; }}</Await></Suspense>}
    >
      <StreamSection shape={tab === "compare" ? "cards" : "form"}>
        <Await read={read}>
          {({ pending, row, ladderCase }) => {
            if (pending) return <TableCard><EmptyState title="Not switched on yet" hint={REINSTATEMENT_PENDING_MESSAGE} /></TableCard>;
            if (!row) notFound();
            if (ladderCase) redirect(`/app/retention/${ladderCase}`);
            const locked = readOnly || !OPEN_CASE_STATUSES.includes(row.status);
            return tab === "needs" ? <CaseNeedsForm key={row.id} row={row} readOnly={locked} />
              : tab === "notes" ? <CaseNoteForm key={row.id} row={row} readOnly={locked} />
                : <CaseComparison row={row} />;
          }}
        </Await>
      </StreamSection>
    </RetentionPage>
  );
}

type CaseRow = NonNullable<Extract<Awaited<ReturnType<typeof loadCase>>, { available: true }>["row"]>;
