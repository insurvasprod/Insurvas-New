import Link from "next/link";
import { redirect } from "next/navigation";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { loadWinback, WINBACK_PENDING_MESSAGE } from "@/lib/retention/winbackStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { WinbackBoard } from "@/components/app/winback-board";
import { WINBACK_VIEWS, isWinbackView, winbackCounts, winbackViewHref, type WinbackView } from "@/components/app/retention/winback-stages";
import { RetentionPage } from "@/components/app/retention/retention-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Retention › Win-back (the `winback` feature; round 7, owner pick 3·A, 2026-11-10). Clients past reinstatement,
 * classified by why they lapsed, each with its cooling-off; at its end a client goes to the agency's Win-back lead
 * list (then the scrub gate). Opening it runs the classification and releases what is due.
 *
 * The title stands alone with its (i); where the clients stand is the tab on the title line (`?show=`), each with
 * its count. The two old notices are counts: Possible claims in red, and an unscrubbed list marks Call now and turns
 * the primary into "Scrub the list first" (it opens the list). The table fills the window.
 *
 * The reinstatement list (LA-5.6) repeated Cases › Lapsed and is retired: its old addresses (`?view=cases`,
 * `?cases=`) land there (round 7: retired addresses redirect), as a retention rep, who has no win-back calls
 * (LA-5.8), always has.
 */
export default async function ReinstatementPage({ searchParams }: { searchParams: Promise<{ view?: string; cases?: string; show?: string }> }) {
  const guard = await guardPage("winback");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Win-back" description="Former clients worth winning back, once the cooling-off has passed." />;
  }
  if (!actAsPage(guard, ["owner", "producer", "retention"])) {
    return <RoleGateNotice featureLabel="Win-back" detail="Only owners, producers and retention reps can open this page." />;
  }
  const { view: oldView, cases: casesView, show } = await searchParams;
  // LA-5.8: a retention rep works reinstatement cases; win-back calls (LA-5.7) are not in the role.
  const canWinback = guard.role !== "retention";
  const listView = oldView === "cases" || casesView !== undefined;
  if (!canWinback && !listView) redirect("/app/retention?step=lapsed");
  // Round 7: the retired "Reinstatement record" list answers on Cases › Lapsed.
  if (listView) redirect("/app/retention?step=lapsed");
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const readOnly = guard.entitlement.access === "read_only";
  const winback = await loadWinback(viewer, { release: !readOnly });
  const info = "Former clients past the carrier's reinstatement window. Each waits out the cooling-off for why they left, then goes on the Win-back lead list, which is scrubbed before anyone dials.";

  if (!winback.available) {
    return <RetentionPage step="reinstatement" title="Win-back" info={info}><TableCard><EmptyState title="Not switched on yet" hint={WINBACK_PENDING_MESSAGE} /></TableCard></RetentionPage>;
  }

  const view: WinbackView = isWinbackView(show) ? show : "open";
  const counts = winbackCounts(winback.rows, winback.claims.length, winback.today);
  // The scrub notice, as a count: someone is on an unscrubbed list, so nobody may be dialled yet.
  const needsScrub = Boolean(winback.listScrub && winback.listScrub !== "scrubbed" && counts.released > 0);
  const tabs = (
    <ViewTabs
      label="Where the former clients stand"
      value={view}
      tabs={WINBACK_VIEWS.map(({ key, label }) => ({
        key,
        label,
        count: counts[key],
        href: winbackViewHref(key),
        ...(key === "claims" ? { tone: "danger" as const } : {}),
        ...(key === "released" && needsScrub ? {
          // ViewTabs has a danger tone only: an amber dot before the label is the warning, said aloud after it.
          marker: <i aria-hidden="true" className="block size-1.5 rounded-full bg-[var(--warning-ink)]" />,
          srSuffix: "(the list needs a scrub before anyone is dialled)",
        } : {}),
      }))}
    />
  );
  const listHref = winback.listId ? `/app/campaigns/${winback.listId}` : "/app/campaigns";
  const primary = <Button asChild><Link href={listHref}>{needsScrub && !readOnly ? "Scrub the list first" : "Open the Win-back list"}</Link></Button>;

  return (
    <RetentionPage step="reinstatement" title="Win-back" info={info} tabs={tabs} actions={primary}>
      <WinbackBoard key={view} data={winback} view={view} />
    </RetentionPage>
  );
}
