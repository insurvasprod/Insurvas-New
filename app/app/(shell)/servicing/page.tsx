import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { loadServicing, SERVICING_PENDING_MESSAGE } from "@/lib/retention/servicingStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ServicingBoard } from "@/components/app/servicing-board";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { Await, RetentionPage } from "@/components/app/retention/retention-page";
import { BUCKETS, asServicingView, bucketOf, localDay, servicingViewHref, type ServicingView } from "@/components/app/retention/servicing-shared";

/**
 * Retention › Waiting on the carrier (the `payment_repair` feature; was "Servicing"). Every change asked of a
 * carrier (payment date, bank or card, mailed bill to bank draft, address), open until the next carrier file
 * proves it. Opening it checks the open requests against the latest files (the database decides). You chase
 * here; the work itself is on the case.
 *
 * Round 7, owner pick 2·A (2026-11-10): the title stands alone with its (i); what you do next is the tabs on its
 * line (Open · Check it · Send it · Waiting · Not in the file · Proven · Cancelled, the `?status=` address), each
 * with its count, red where a person is needed (Check it, Send it). The six cards went; the table fills the window.
 *
 * Paper bill → bank (LA-5.5) was a second list of the clients on Cases › Paperwork (a mailed bill): one place to
 * work them since the critique of 2026-11-05 (E1), so its address opens that tab. Its call pages still answer.
 */
export default async function ServicingPage({ searchParams }: { searchParams: Promise<{ status?: string; view?: string }> }) {
  const guard = await guardPage("payment_repair");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Waiting on the carrier" description="Changes asked of the carrier, tracked until the next carrier file proves them." />;
  }
  if (!actAsPage(guard, ["owner", "producer", "retention"])) {
    return <RoleGateNotice featureLabel="Waiting on the carrier" detail="Only owners, producers and retention reps can open servicing requests." />;
  }
  const { view, status } = await searchParams;
  if (view === "campaign") redirect("/app/retention?step=paperwork&reason=mailed_bill");
  const readOnly = guard.entitlement.access === "read_only";
  // Frame first (UI-CONSISTENCY §7a): the title, the tabs and New request draw at once; the read (it checks the open
  // requests against the latest files, as before) starts here, and the tab counts and the board wait on it.
  const read = scopeFor(guard.context).then((scope) => loadServicing({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope }));
  const info = "Every change asked of a carrier, open until the next carrier file shows it. A row opens its request, where you mark it sent, check it with the carrier or cancel it.";

  // The tabs are the board's `?status=` address; the board reads it too. A count is red where a person is needed.
  const current = asServicingView(status);
  const tabsOf = (rows: ServicingRows | null) => {
    const today = localDay();
    const counts = new Map<ServicingView, number>();
    for (const r of rows ?? []) {
      const b = bucketOf(r, today);
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    const count = (n: number) => (rows ? { count: n } : {});
    const open = (counts.get("check") ?? 0) + (counts.get("send") ?? 0) + (counts.get("waiting") ?? 0);
    return (
      <ViewTabs
        label="Waiting on the carrier"
        value={current}
        tabs={[
          { key: "open" as ServicingView, label: "Open", ...count(open), href: servicingViewHref("open") },
          ...BUCKETS.map((b) => ({ key: b.key as ServicingView, label: b.label, ...count(counts.get(b.key) ?? 0), tone: b.key === "check" || b.key === "send" ? ("danger" as const) : undefined, href: servicingViewHref(b.key) })),
        ]}
      />
    );
  };
  // Read-only (2·4): New request stays on the line, paused, with the reason on hover.
  const actions = readOnly ? (
    <span title="Paused while the account is read-only." className="inline-flex"><Button type="button" disabled>New request</Button></span>
  ) : (
    <Button asChild><Link href="/app/servicing/new">New request</Link></Button>
  );

  const tabs = <Suspense fallback={tabsOf(null)}><Await read={read}>{(list) => (list.available ? tabsOf(list.rows) : null)}</Await></Suspense>;

  return (
    <RetentionPage step="servicing" info={info} tabs={tabs} actions={actions}>
      <StreamSection shape="table">
        <Await read={read}>
          {(list) => (list.available
            ? <ServicingBoard rows={list.rows} readOnly={readOnly} />
            : <TableCard><EmptyState title="Not switched on yet" hint={SERVICING_PENDING_MESSAGE} /></TableCard>)}
        </Await>
      </StreamSection>
    </RetentionPage>
  );
}

type ServicingRows = Extract<Awaited<ReturnType<typeof loadServicing>>, { available: true }>["rows"];
