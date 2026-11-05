import { notFound } from "next/navigation";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { personName } from "@/lib/format/personName";
import { fileDay } from "@/lib/ingestion/constants";
import { CASE_STATUS_LABELS, OPEN_CASE_STATUSES, type Urgency } from "@/lib/retention/reinstatement";
import { loadCase, REINSTATEMENT_PENDING_MESSAGE } from "@/lib/retention/reinstatementStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionPage, retentionTrail } from "@/components/app/retention/retention-page";
import { CaseActions, CaseComparison, CaseNeedsForm, CaseNoteForm } from "@/components/app/retention/reinstatement-case";
import { EmptyState } from "@/components/ui/page-states";
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
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};

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
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const readOnly = guard.entitlement.access === "read_only";
  const loaded = await loadCase(viewer, id);
  if (!loaded.available) {
    return <RetentionPage step="reinstatement" title="Reinstatement case"><TableCard><EmptyState title="Not switched on yet" hint={REINSTATEMENT_PENDING_MESSAGE} /></TableCard></RetentionPage>;
  }
  const row = loaded.row;
  if (!row) notFound();

  const open = OPEN_CASE_STATUSES.includes(row.status);
  const locked = readOnly || !open;
  const name = row.clientName ? personName(row.clientName) : row.policyNumber;
  const chip = !open ? (
    <StatusChip tone={row.status === "reinstated" ? "good" : row.status === "expired" ? "danger" : "neutral"}>{CASE_STATUS_LABELS[row.status]}</StatusChip>
  ) : row.deadline === null || row.daysRemaining === null ? (
    <StatusChip tone="neutral">No carrier window</StatusChip>
  ) : (
    <StatusChip tone={COUNTDOWN_TONE[row.urgency]}>
      {row.daysRemaining <= 0 ? `Closes today · ${fileDay(row.deadline)}` : `${row.daysRemaining} ${row.daysRemaining === 1 ? "day" : "days"} left · closes ${fileDay(row.deadline)}`}
    </StatusChip>
  );
  const facts = [
    row.phone ? phoneText(row.phone) : "No phone",
    `${row.carrierName} ${row.policyNumber}`,
    `lapsed ${fileDay(row.lapsedOn)}`,
    CASE_STATUS_LABELS[row.status],
    !open && row.resolvedAt ? `closed ${fileDay(row.resolvedAt.slice(0, 10))}` : null,
    !open ? row.declineReason : null,
  ].filter(Boolean).join(" · ");
  const base = `/app/reinstatement/${row.id}`;

  return (
    <RetentionPage
      step="reinstatement"
      title={name}
      chip={chip}
      facts={facts}
      breadcrumbs={retentionTrail("reinstatement", name)}
      lead={<ViewTabs label={`Case of ${name}`} value={tab} tabs={[
        { key: "compare", label: "Reinstate or sell new", href: base },
        { key: "needs", label: "What the carrier needs", href: `${base}?tab=needs` },
        { key: "notes", label: "Notes", href: `${base}?tab=notes` },
      ]} />}
      actions={locked ? undefined : <CaseActions row={row} />}
    >
      {tab === "needs" ? <CaseNeedsForm key={row.id} row={row} readOnly={locked} />
        : tab === "notes" ? <CaseNoteForm key={row.id} row={row} readOnly={locked} />
          : <CaseComparison row={row} />}
    </RetentionPage>
  );
}
