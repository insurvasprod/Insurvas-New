import Link from "next/link";

import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ViewTabs } from "@/components/app/book-of-business-views";
import { CarrierDiscrepancies, DisputeLetters, type HandDiscrepancyRow } from "@/components/app/carrier-discrepancies";
import { DISCREPANCIES_PENDING_MESSAGE, loadDiscrepancies } from "@/lib/ingestion/discrepancyStore";
import { payTimingGapText } from "@/lib/ingestion/carrierRules";
import { loadPayTimingGaps } from "@/lib/ingestion/carrierRulesStore";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { DISCREPANCY_SCHEMA_PENDING_MESSAGE, listDiscrepancies } from "@/lib/discrepancies/service";

/**
 * Book of Business › Discrepancies: "You appear to be owed $X".
 *
 * One list (2026-10-08 overlap merge, not a tab per source) of the findings from the carriers' own
 * files (LA-4.15: owed, coming back, held) and the findings from statements imported by hand
 * (LA-4.5: never paid, short-paid, wrong rate, charged back twice or while in force), each with
 * the figures behind it and its own decisions, and a source filter. Letters is the carrier-file
 * findings' saved letters; a hand finding's letter opens on its own page.
 *
 * The page only reads: findings are recomputed after each change to their facts (and on "Check
 * now"), never because someone opened it. Owner and bookkeeper (`statements.view`), as the menu
 * item. A read-only account reads it and can print a letter, but cannot record decisions.
 * The old "From imported statements" address (?view=statements) lands on the list, filtered to it.
 */
export default async function DiscrepanciesPage({ searchParams }: { searchParams: Promise<{ view?: string; source?: string }> }) {
  const guard = await guardPage("discrepancy_report");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Discrepancies" description="What each carrier paid against what your contract says it owes, with a dispute letter for each one." />;
  }
  if (!actAsPagePermission(guard, "statements.view")) {
    return <RoleGateNotice featureLabel="Discrepancies" detail="Discrepancies are worked by the account owner or a bookkeeper." />;
  }

  const tenantId = guard.context.tenantId;
  const { view, source } = await searchParams;
  const readOnly = guard.entitlement.access === "read_only";
  const [found, list, untimed] = await Promise.all([
    loadDiscrepancies(tenantId),
    view === "letters" ? null : listDiscrepancies(tenantId),
    // Carriers missing commission is not checked for (no pay trigger or lag): said, never assumed.
    view === "letters" ? null : loadPayTimingGaps(tenantId).catch((error) => { console.error("[discrepancies] pay timing could not be read", error); return null; }),
  ]);
  const hand: HandDiscrepancyRow[] = (list?.available ? list.items : []).map((item) => ({
    id: item.id, kind: item.kind, status: item.status, owedCents: item.owedCents, policyNumber: item.policyNumber, insuredName: item.insuredName,
    carrierId: item.carrierId, carrierName: item.carrierName, periodStart: item.periodStart, periodEnd: item.periodEnd,
    expectedCents: item.detail?.expectedCents ?? 0, receivedCents: item.detail?.receivedCents ?? 0, explanation: item.detail?.explanation ?? "",
    note: item.note, statusChangedByName: item.statusChangedByName, statusChangedAt: item.statusChangedAt, history: item.history,
  }));
  const working = (found.available ? found.items.filter((i) => i.status === "open" || i.status === "disputed").length : 0) + hand.filter((i) => i.status === "open" || i.status === "disputed").length;
  const pending = "rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]";

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="Discrepancies"
        description={view === "letters" ? "Letters drafted from the findings: you send them, and record how each one ended." : "What you are owed, what will be taken back, and what is held, from your carriers' files and the statements you imported, with the figures behind each."}
        actions={view === "letters" ? undefined : <Button asChild type="button" variant="outline"><Link href="/app/statements">Statements</Link></Button>}
      />
      <ViewTabs
        label="Discrepancy views"
        active={view === "letters" ? "letters" : "items"}
        tabs={[
          { key: "items", label: "Discrepancies", count: view === "letters" ? undefined : working, href: "/app/discrepancies" },
          { key: "letters", label: "Letters", href: "/app/discrepancies?view=letters" },
        ]}
      />
      {!found.available && <div role="status" className={pending}>{DISCREPANCIES_PENDING_MESSAGE}</div>}
      {list && !list.available && <div role="status" className={pending}>{DISCREPANCY_SCHEMA_PENDING_MESSAGE}</div>}
      {untimed && untimed.length > 0 && <div role="status" className={pending}>Missing commission is not checked for {untimed.length === 1 ? "1 carrier" : `${untimed.length} carriers`} with no pay trigger or lag set: {payTimingGapText(untimed)}. <Link href="/app/carrier-rules" className="font-medium underline">Set them in Carrier rules</Link>.</div>}
      {found.available && found.truncated && <div role="status" className={pending}>Showing the first {found.items.length.toLocaleString("en-US")} findings, most serious first; the rest are not listed here.</div>}
      {view === "letters" ? (
        found.available && <DisputeLetters disputes={found.disputes} readOnly={readOnly} />
      ) : (
        <CarrierDiscrepancies
          items={found.available ? found.items : []}
          readOnly={readOnly}
          handItems={hand}
          handCanWrite={!readOnly}
          handBlockedReason={readOnly ? "Reading and printing remain available; decisions are paused while the account is read-only." : null}
          initialSource={view === "statements" ? "hand" : source ?? ""}
        />
      )}
    </div>
  );
}
