import Link from "next/link";

import { scopeFor } from "@/lib/agency/visibility";
import { Button } from "@/components/ui/button";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { ensureCasesFresh, LADDER_PENDING_MESSAGE } from "@/lib/retention/cases/sync";
import { loadLadder } from "@/lib/retention/cases/store";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { LadderBoard } from "@/components/app/retention/ladder-board";
import { RetentionPage } from "@/components/app/retention/retention-page";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Retention › Cases (owner 2026-11-05: "Retention comes from the uploaded files"; pick A; docs/retention/SPEC.md).
 * The ladder: every policy the policy and commission files flag, at its risk point, with the next action. The
 * files open, move and close cases; opening this page refreshes them at most every 15 minutes (grace running out
 * needs no file). Gated on the Retention module; owner (every case), producer (their policies), retention (their
 * cases).
 */
export default async function RetentionCasesPage({ searchParams }: { searchParams: Promise<{ step?: string; owner?: string }> }) {
  const [guard, query] = await Promise.all([guardPage("chargeback_radar"), searchParams]);
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Retention" description="Every policy the carrier files flag, at its risk point, with what to do." />;
  if (!actAsPage(guard, ["owner", "producer", "retention"])) return <RoleGateNotice featureLabel="Retention" detail="Only owners, producers and retention reps work retention cases." />;
  await ensureCasesFresh(guard.context.tenantId);
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const data = await loadLadder(viewer);
  // Round 3 (owner 2026-11-06): the steps are the risk cards on the page; the title line says whose cases.
  const mine = data.available ? data.open.filter((r) => r.ownerId === guard.context.userId).length : 0;
  const active = query.owner === "me" ? "mine" : "all";
  const keep = query.step ? `step=${encodeURIComponent(query.step)}` : "";
  const canOpen = data.available && guard.entitlement.access !== "read_only";

  return (
    <RetentionPage step="cases"
      title="Retention"
      info="Every policy the uploaded policy and commission files flag, at its risk point: a payment problem, a pending lapse, lapsed but reinstatable, or lost, with paperwork beside them. A case leaves as saved only when a later file proves it fixed."
      tabs={data.available ? <ViewTabs label="Whose cases" value={active} tabs={[
        { key: "all", label: "All", count: data.open.length, href: keep ? `/app/retention?${keep}` : "/app/retention" },
        ...(mine > 0 ? [{ key: "mine", label: "Mine", count: mine, href: `/app/retention?${keep ? `${keep}&` : ""}owner=me` }] : []),
      ]} /> : undefined}
      actions={canOpen ? <Button asChild variant="outline"><Link href="/app/retention/new">New case</Link></Button> : undefined}
    >
      {data.available ? <LadderBoard data={data} isOwner={guard.role === "owner"} viewerId={guard.context.userId} /> : <TableCard><EmptyState title="Not switched on yet" hint={LADDER_PENDING_MESSAGE} /></TableCard>}
    </RetentionPage>
  );
}
