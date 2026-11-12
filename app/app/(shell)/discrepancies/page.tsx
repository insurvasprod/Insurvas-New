import Link from "next/link";

import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { PayIssuesList } from "@/components/app/commissions/pay-issues/pay-issues-list";
import { LettersList, type LetterRow } from "@/components/app/commissions/pay-issues/letters-list";
import { CheckNowButton } from "@/components/app/commissions/pay-issues/check-now";
import { Button } from "@/components/ui/button";
import { ViewTabs } from "@/components/ui/view-tabs";
import { loadPayTimingGaps } from "@/lib/ingestion/carrierRulesStore";
import { loadPayIssues } from "@/lib/discrepancies/payIssues";
import { LETTER_OUT_STATUSES, LETTER_SETTLED_STATUSES, groupPayIssues, orderPayIssues, payIssueCarrierKey, payIssueHref } from "@/lib/commissions/payIssueGroups";

/**
 * Commissions › Pay issues (round 7, owner pick 2·A, 2026-11-10; docs/la4/mockups-r7/commissions.html 2·A–2·5).
 *
 * The title alone with its (i); Open · Letters out · Settled · Closed on its line (`?view=`; the old
 * `?view=letters`, `?view=closed` and `?view=statements` addresses still land), then Check now and the primary
 * "Work the largest", which opens the largest group's first issue (its ‹ › walk the group).
 *
 * Open lists the findings from the carriers' own files (LA-4.15) and from statements imported by hand (LA-4.5) as
 * one list: by carrier and kind (each group opening its page, where its letter is drafted), or one by one (each row
 * opening its issue's page). Warnings are counts, never notices: "Not checked" lists the carriers missing
 * commission is not checked for. Letters out holds the letters waiting on you or the carrier; Settled the answered
 * ones, with each carrier's record.
 *
 * The page only reads: findings are recomputed after each change to their facts (and on "Check now"), never because
 * someone opened it. Owner and bookkeeper (`statements.view`), as the menu item. A read-only account reads it.
 */
type Tab = "open" | "letters" | "settled" | "closed";

export default async function DiscrepanciesPage({ searchParams }: { searchParams: Promise<{ view?: string; source?: string; carrier?: string }> }) {
  const guard = await guardPage("discrepancy_report");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Pay issues" description="What each carrier paid against what your contract says it owes, with a dispute letter for each one." />;
  }
  if (!actAsPagePermission(guard, "statements.view")) {
    return <RoleGateNotice featureLabel="Pay issues" detail="Pay issues are worked by the account owner or a bookkeeper." />;
  }

  const tenantId = guard.context.tenantId;
  const { view, source, carrier } = await searchParams;
  const tab: Tab = view === "letters" ? "letters" : view === "settled" ? "settled" : view === "closed" ? "closed" : "open";
  const readOnly = guard.entitlement.access === "read_only";
  const lists = tab === "open" || tab === "closed";
  const [read, untimed] = await Promise.all([
    loadPayIssues(tenantId, { names: lists }),
    // Carriers missing commission is not checked for (no pay trigger or lag): a count on a chip, never assumed.
    tab === "open" ? loadPayTimingGaps(tenantId).catch((error) => { console.error("[pay-issues] pay timing could not be read", error); return null; }) : null,
  ]);

  const working = read.issues.filter((i) => i.status !== "closed");
  const closed = read.issues.filter((i) => i.status === "closed");
  const letters: LetterRow[] = read.disputes.map((d) => ({ id: d.id, carrierId: d.carrierId, carrierName: d.carrierName, createdAt: d.createdAt, items: d.discrepancyIds.length, totalCents: d.totalCents, status: d.status, sentVia: d.sentVia, sentAt: d.sentAt, outcomeCents: d.outcomeCents, resolvedAt: d.resolvedAt }));
  const out = letters.filter((l) => LETTER_OUT_STATUSES.has(l.status));
  const settled = letters.filter((l) => LETTER_SETTLED_STATUSES.has(l.status));

  // The primary: the largest group's first issue, in the group's own order (its ‹ › walk the group).
  const largest = groupPayIssues(working)[0];
  const first = largest ? orderPayIssues(working.filter((i) => i.type === largest.type && payIssueCarrierKey(i) === largest.carrierKey))[0] : undefined;

  const initialSource = view === "statements" || source === "hand" ? "hand" : source === "carrier" ? "carrier" : "";
  return (
    <CommissionsPage
      step="discrepancies"
      info={<>What each carrier paid against what your contract says it owes. A group is one carrier and one kind of issue: open it to see each policy and to draft its letter. Insurvas never sends a letter; you send it, then record what the carrier did.</>}
      tabs={
        <ViewTabs
          label="Pay issue views"
          value={tab}
          tabs={[
            { key: "open", label: "Open", count: working.length, href: "/app/discrepancies" },
            { key: "letters", label: "Letters out", count: out.length, href: "/app/discrepancies?view=letters" },
            { key: "settled", label: "Settled", count: settled.length, href: "/app/discrepancies?view=settled" },
            { key: "closed", label: "Closed", count: closed.length, href: "/app/discrepancies?view=closed" },
          ]}
        />
      }
      actions={
        <span className="inline-flex flex-wrap gap-2">
          {tab === "open" && <CheckNowButton readOnly={readOnly} />}
          {first && <Button asChild type="button"><Link href={payIssueHref(first)}>Work the largest</Link></Button>}
        </span>
      }
    >
      {tab === "letters" || tab === "settled" ? (
        <LettersList letters={tab === "letters" ? out : settled} settled={settled} tab={tab === "letters" ? "out" : "settled"} initialCarrier={carrier ?? ""} />
      ) : (
        <PayIssuesList
          issues={tab === "closed" ? closed : working}
          tab={tab}
          unchecked={untimed ?? []}
          summary={tab === "open" ? read.summary : null}
          initialSource={initialSource}
          today={read.today}
          unavailable={!read.available}
        />
      )}
    </CommissionsPage>
  );
}
