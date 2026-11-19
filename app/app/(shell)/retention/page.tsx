import { Suspense } from "react";
import Link from "next/link";

import { scopeFor } from "@/lib/agency/visibility";
import { Button } from "@/components/ui/button";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { ensureCasesFresh, LADDER_PENDING_MESSAGE } from "@/lib/retention/cases/sync";
import { loadLadder } from "@/lib/retention/cases/store";
import { STEP_TABS, caseHref, filterCases, groupOf, listQuery, parseListFilters, visibleCases } from "@/lib/retention/cases/listOrder";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { LadderBoard } from "@/components/app/retention/ladder-board";
import { NewCaseButton } from "@/components/app/retention/new-case";
import { Await, RetentionPage } from "@/components/app/retention/retention-page";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Retention › Cases (owner 2026-11-05: "Retention comes from the uploaded files"; docs/retention/SPEC.md). Round 7
 * (owner pick 1·A, 2026-11-10; docs/la4/mockups-r7/retention.html): the title "Cases" alone; the ladder's steps are
 * the tabs on its line (Payment problem · Pending lapse · Can reinstate · Lost · Paperwork · Closed), each with its
 * count, red when something in it is past due; New case (a dialog) and Work the next case (this list's first case)
 * beside them. The files open, move and close cases; opening this page refreshes them at most every 15 minutes.
 * Gated on the Retention module; owner (every case), producer (their policies), retention (their cases).
 */
export default async function RetentionCasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [guard, query] = await Promise.all([guardPage("chargeback_radar"), searchParams]);
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Retention" description="Every policy the carrier files flag, at its risk point, with what to do." />;
  if (!actAsPage(guard, ["owner", "producer", "retention"])) return <RoleGateNotice featureLabel="Retention" detail="Only owners, producers and retention reps work retention cases." />;
  const viewerId = guard.context.userId;
  const tenantId = guard.context.tenantId;
  // Frame first (UI-CONSISTENCY §7a): the title, the steps and the buttons draw at once; the read starts here (the
  // refresh first, as before, the scope beside it) and the tab counts, Work the next case and the board each wait on it.
  const scope = scopeFor(guard.context);
  const read = ensureCasesFresh(tenantId).then(async () => loadLadder({ tenantId, userId: viewerId, role: guard.role, scope: await scope }));
  const readOnly = guard.entitlement.access === "read_only";
  const f = parseListFilters((key) => query[key]);
  const info = "Every policy the uploaded policy and commission files flag, at its risk point: a payment problem, a pending lapse, lapsed but reinstatable, or lost, with paperwork beside them. A case leaves as saved only when a later file proves it fixed.";

  // Each tab's count follows the filters on the address (Mine, a carrier…); red when something in it is past due.
  const tabHref = (step: (typeof STEP_TABS)[number]["step"]) => `/app/retention?${listQuery({ ...f, step, all: false })}`;
  const tabsOf = (data: Ladder | null) => {
    const kept = data ? filterCases(data.open, { ...f }, viewerId) : [];
    return (
      <ViewTabs
        label="Steps"
        // A reason across every step (Settings › Ladder) marks no tab.
        value={f.all ? ("" as typeof f.step) : f.step}
        tabs={STEP_TABS.map(({ step, label }) => {
          if (!data) return { key: step, label, href: tabHref(step) };
          if (step === "closed") return { key: step, label, count: data.closed.length, href: tabHref(step) };
          const these = kept.filter((r) => r.step === step);
          const late = these.some((r) => groupOf(r) === "over");
          return { key: step, label, count: these.length, tone: late ? ("danger" as const) : undefined, href: tabHref(step) };
        })}
      />
    );
  };
  // Work the next case: this tab's first case, in working order (Closed has none to work).
  const nextCase = (data: Awaited<typeof read>) => {
    const first = f.step === "closed" || !data.available ? null : visibleCases(data.open, f, viewerId)[0] ?? null;
    return first && !readOnly ? <Button asChild><Link href={caseHref(first.id, f, "do")}>Work the next case</Link></Button> : null;
  };
  const actions = (
    <span className="inline-flex flex-wrap gap-2">
      {!readOnly && <NewCaseButton />}
      <Suspense fallback={null}><Await read={read}>{nextCase}</Await></Suspense>
    </span>
  );

  return (
    <RetentionPage step="cases" title="Cases" info={info} tabs={<Suspense fallback={tabsOf(null)}><Await read={read}>{(data) => (data.available ? tabsOf(data) : null)}</Await></Suspense>} actions={actions}>
      <StreamSection shape="table">
        <Await read={read}>
          {(data) => (data.available
            ? <LadderBoard data={data} isOwner={guard.role === "owner"} viewerId={viewerId} />
            : <TableCard><EmptyState title="Not switched on yet" hint={LADDER_PENDING_MESSAGE} /></TableCard>)}
        </Await>
      </StreamSection>
    </RetentionPage>
  );
}

type Ladder = Extract<Awaited<ReturnType<typeof loadLadder>>, { available: true }>;
