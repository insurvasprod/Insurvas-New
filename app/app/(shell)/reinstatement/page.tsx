import Link from "next/link";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { loadReinstatement, REINSTATEMENT_PENDING_MESSAGE } from "@/lib/retention/reinstatementStore";
import { loadWinback, WINBACK_PENDING_MESSAGE } from "@/lib/retention/winbackStore";
import { ViewTabs } from "@/components/app/book-of-business-views";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { ReinstatementBoard } from "@/components/app/reinstatement-board";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { WinbackBoard } from "@/components/app/winback-board";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { RetentionPage } from "@/components/app/retention/retention-page";

/**
 * Book › Reinstatement (the `winback` feature). Two views:
 *   · Reinstatement (LA-5.6): lapsed policies the carrier will still take back, fewest days first.
 *     Opening it asks the database to open, reinstate, expire and alert.
 *   · Win-back (LA-5.7): clients past reinstatement, classified by why they lapsed, each with its
 *     cooling-off; at its end a client goes to the agency's Win-back lead list (then the scrub gate).
 *     Opening it runs the classification and releases what is due. Its title line opens the agency's
 *     Win-back lead list (the campaign ensure_winback_list made; Source › Campaigns before it exists).
 */
export default async function ReinstatementPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const guard = await guardPage("winback");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Reinstatement" description="Lapsed policies the carrier will still take back, and former clients worth winning back." />;
  }
  if (!actAsPage(guard, ["owner", "producer", "retention"])) {
    return <RoleGateNotice featureLabel="Reinstatement" detail="Only owners, producers and retention reps can work reinstatement cases." />;
  }
  const { view } = await searchParams;
  // LA-5.8: a retention rep works reinstatement cases; win-back calls (LA-5.7) are not in the role.
  const canWinback = guard.role !== "retention";
  const winbackView = view === "winback" && canWinback;
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const readOnly = guard.entitlement.access === "read_only";
  const [cases, winback] = winbackView ? [null, await loadWinback(viewer, { release: !readOnly })] : [await loadReinstatement(viewer), null];
  const listAction = winback?.available ? (
    <Button asChild variant="outline"><Link href={winback.listId ? `/app/campaigns/${winback.listId}` : "/app/campaigns"}>Open the Win-back list</Link></Button>
  ) : undefined;

  return (
    <RetentionPage step="reinstatement" actions={listAction} lead={canWinback ? (
        <ViewTabs
          label="Reinstatement views"
          active={winbackView ? "winback" : "cases"}
          tabs={[
            { key: "cases", label: "Reinstatement", href: "/app/reinstatement" },
            { key: "winback", label: "Win-back", href: "/app/reinstatement?view=winback" },
          ]}
        />
      ) : undefined}>
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
