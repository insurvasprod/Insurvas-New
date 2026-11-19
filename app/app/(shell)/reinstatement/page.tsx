import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { loadWinback, WINBACK_PENDING_MESSAGE } from "@/lib/retention/winbackStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { WinbackBoard } from "@/components/app/winback-board";
import { WINBACK_VIEWS, isWinbackView, winbackCounts, winbackViewHref, type WinbackView } from "@/components/app/retention/winback-stages";
import { Await, RetentionPage } from "@/components/app/retention/retention-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
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
  const readOnly = guard.entitlement.access === "read_only";
  // Frame first (UI-CONSISTENCY §7a): the title, the tabs and the primary draw at once; the read (it classifies and
  // releases what is due, as before) starts here, and the tab counts, the primary and the board each wait on it.
  const read = scopeFor(guard.context).then((scope) => {
    const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope };
    return loadWinback(viewer, { release: !readOnly });
  });
  const info = "Former clients past the carrier's reinstatement window. Each waits out the cooling-off for why they left, then goes on the Win-back lead list, which is scrubbed before anyone dials.";
  const view: WinbackView = isWinbackView(show) ? show : "open";

  // The scrub notice, as a count: someone is on an unscrubbed list, so nobody may be dialled yet.
  const scrubOf = (winback: Winback) => {
    const counts = winbackCounts(winback.rows, winback.claims.length, winback.today);
    return { counts, needsScrub: Boolean(winback.listScrub && winback.listScrub !== "scrubbed" && counts.released > 0) };
  };
  const tabsOf = (winback: Winback | null) => {
    const { counts, needsScrub } = winback ? scrubOf(winback) : { counts: null, needsScrub: false };
    return (
      <ViewTabs
        label="Where the former clients stand"
        value={view}
        tabs={WINBACK_VIEWS.map(({ key, label }) => ({
          key,
          label,
          ...(counts ? { count: counts[key] } : {}),
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
  };
  const primaryOf = (winback: Winback) => {
    const listHref = winback.listId ? `/app/campaigns/${winback.listId}` : "/app/campaigns";
    return <Button asChild><Link href={listHref}>{scrubOf(winback).needsScrub && !readOnly ? "Scrub the list first" : "Open the Win-back list"}</Link></Button>;
  };
  // Until the read lands, the primary holds its place, paused.
  const primary = (
    <Suspense fallback={<Button type="button" disabled>Open the Win-back list</Button>}>
      <Await read={read}>{(winback) => (winback.available ? primaryOf(winback) : null)}</Await>
    </Suspense>
  );

  return (
    <RetentionPage step="reinstatement" title="Win-back" info={info} tabs={<Suspense fallback={tabsOf(null)}><Await read={read}>{(winback) => (winback.available ? tabsOf(winback) : null)}</Await></Suspense>} actions={primary}>
      <StreamSection shape="table">
        <Await read={read}>
          {(winback) => (winback.available
            ? <WinbackBoard key={view} data={winback} view={view} />
            : <TableCard><EmptyState title="Not switched on yet" hint={WINBACK_PENDING_MESSAGE} /></TableCard>)}
        </Await>
      </StreamSection>
    </RetentionPage>
  );
}

type Winback = Extract<Awaited<ReturnType<typeof loadWinback>>, { available: true }>;
