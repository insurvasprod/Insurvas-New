import Link from "next/link";
import { redirect } from "next/navigation";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { loadReinstatement, REINSTATEMENT_PENDING_MESSAGE } from "@/lib/retention/reinstatementStore";
import { loadWinback, WINBACK_PENDING_MESSAGE } from "@/lib/retention/winbackStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { ReinstatementBoard } from "@/components/app/reinstatement-board";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { WinbackBoard } from "@/components/app/winback-board";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { RetentionPage } from "@/components/app/retention/retention-page";

/**
 * Retention › Win-back (the `winback` feature). Since the critique of 2026-11-05 (E4) this address opens Win-back
 * (LA-5.7): clients past reinstatement, classified by why they lapsed, each with its cooling-off; at its end a
 * client goes to the agency's Win-back lead list (then the scrub gate). Opening it runs the classification and
 * releases what is due. Its title line opens the agency's Win-back lead list.
 *
 * The reinstatement list (LA-5.6) repeated Cases › Lapsed: a lapse inside its window is worked on its Retention
 * case. Its list still answers at `?view=cases` (and `?cases=closed`, the last 90 days) for the record; a
 * retention rep, who has no win-back calls (LA-5.8), lands on Cases › Lapsed.
 */
export default async function ReinstatementPage({ searchParams }: { searchParams: Promise<{ view?: string; cases?: string }> }) {
  const guard = await guardPage("winback");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Win-back" description="Former clients worth winning back, once the cooling-off has passed." />;
  }
  if (!actAsPage(guard, ["owner", "producer", "retention"])) {
    return <RoleGateNotice featureLabel="Win-back" detail="Only owners, producers and retention reps can open this page." />;
  }
  const { view, cases: casesView } = await searchParams;
  // LA-5.8: a retention rep works reinstatement cases; win-back calls (LA-5.7) are not in the role.
  const canWinback = guard.role !== "retention";
  const listView = view === "cases" || casesView !== undefined;
  if (!canWinback && !listView) redirect("/app/retention?step=lapsed");
  const winbackView = canWinback && !listView;
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const readOnly = guard.entitlement.access === "read_only";
  const [cases, winback] = winbackView ? [null, await loadWinback(viewer, { release: !readOnly })] : [await loadReinstatement(viewer), null];
  const listAction = winback?.available ? (
    <Button asChild variant="outline"><Link href={winback.listId ? `/app/campaigns/${winback.listId}` : "/app/campaigns"}>Open the Win-back list</Link></Button>
  ) : undefined;

  return (
    <RetentionPage step="reinstatement" title={winbackView ? "Win-back" : "Reinstatement record"} actions={listAction}>
    <>
      {winback ? (
        winback.available ? <WinbackBoard data={winback} readOnly={readOnly} /> : <TableCard><EmptyState title="Not switched on yet" hint={WINBACK_PENDING_MESSAGE} /></TableCard>
      ) : cases && cases.available ? (
        <ReinstatementBoard data={cases} readOnly={readOnly} />
      ) : (
        <TableCard>
          <EmptyState title="Not switched on yet" hint={REINSTATEMENT_PENDING_MESSAGE} />
        </TableCard>
      )}
    </>
    </RetentionPage>
  );
}
