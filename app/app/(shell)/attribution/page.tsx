import Link from "next/link";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { CreditQueue } from "@/components/app/commissions/credit/credit-queue";
import { CreditAgentCodes } from "@/components/app/commissions/credit/credit-agent-codes";
import { CREDIT_HREF, itemHref, type CreditView } from "@/components/app/commissions/credit/credit-core";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { readCreditQueue } from "@/lib/agency/moneyStores";
import { loadMatching, MATCHING_PENDING_MESSAGE } from "@/lib/ingestion/policyMatchingStore";
import { ATTRIBUTION_PENDING_MESSAGE, unmappedAgentCodes } from "@/lib/needsYou/store";
import { agencyToday } from "@/lib/ingestion/agencyDay";

const VIEWS: CreditView[] = ["decide", "codes", "decided"];

/**
 * AG-1.4 · Commissions › Who gets the credit (round 7 direction A, owner 2026-11-10, docs/la4/mockups-r7/
 * commissions.html 3·A): the Attribution queue at its own address again, between Pay issues and Producer pay. Two
 * tabs, two jobs: To decide (a $ line to credit, a row opens its page) and Agent codes (a code to map, which then
 * credits every line on it, mapped in Carrier sync's own dialog); Decided holds the last 30 days. Needs you keeps a
 * Credit chip, so Carrier sync's count still adds up. Opening it writes nothing.
 */
export default async function AttributionPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Who gets the credit" description="Statement lines two producers could own, or no producer has yet." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Who gets the credit" detail="The owner, admins and the bookkeeper decide who gets the credit." />;
  const { view: asked } = await searchParams;
  const view: CreditView = VIEWS.includes(asked as CreditView) ? (asked as CreditView) : "decide";
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";

  const [queue, codes, matching, today] = await Promise.all([
    readCreditQueue(tenantId).catch((error: unknown) => { console.error("[who gets the credit]", error); return null; }),
    view === "codes" ? Promise.resolve(null) : unmappedAgentCodes(tenantId).catch(() => null),
    view === "codes" ? loadMatching(tenantId).catch(() => null) : Promise.resolve(null),
    agencyToday(tenantId).catch(() => new Date().toISOString().slice(0, 10)),
  ]);
  const codeCount = view === "codes" ? (matching?.available ? matching.unmapped.length : null) : codes?.length ?? null;
  const oldest = queue?.open[0] ?? null;
  const here = (next: CreditView) => (next === "decide" ? CREDIT_HREF : `${CREDIT_HREF}?view=${next}`);

  let body;
  if (view === "codes") {
    body = !matching ? <TableCard><ErrorState detail="The agent codes could not be read. Refresh to try again." /></TableCard>
      : !matching.available ? <TableCard><EmptyState title={MATCHING_PENDING_MESSAGE} hint="Agent codes open here once it is applied." /></TableCard>
        : <CreditAgentCodes unmapped={matching.unmapped} members={matching.members} readOnly={readOnly} />;
  } else {
    body = !queue ? <TableCard><ErrorState detail={`${ATTRIBUTION_PENDING_MESSAGE} If it is applied, refresh to try again.`} /></TableCard>
      : <CreditQueue rows={view === "decided" ? queue.decided : queue.open} decided={view === "decided"} today={today} />;
  }

  return (
    <CommissionsPage
      step="attribution"
      info="A carrier statement line Insurvas could not safely give to one producer: the writing number and the application name different people, or the line names nobody yet. Decide who it counts for, with a reason."
      tabs={<ViewTabs<CreditView> label="Who gets the credit" value={view} tabs={[
        { key: "decide", label: "To decide", count: queue?.open.length ?? null, tone: "danger", href: here("decide") },
        { key: "codes", label: "Agent codes", count: codeCount, tone: "danger", href: here("codes") },
        { key: "decided", label: "Decided", count: queue?.decided.length ?? null, href: here("decided") },
      ]} />}
      actions={oldest && !readOnly
        ? <Button asChild><Link href={itemHref(oldest.id)}>Decide the oldest</Link></Button>
        : <Button type="button" disabled title={readOnly ? "Paused while the account is read-only." : "Nothing to decide."}>Decide the oldest</Button>}
    >
      {body}
    </CommissionsPage>
  );
}
