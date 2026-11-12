import { redirect } from "next/navigation";

import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { DataInPage } from "@/components/app/data-in/data-in-page";
import { CarrierCoverageList, type CoverageListRow, type TermsTab } from "@/components/app/book/setup/carrier-coverage-list";
import { WindowQueueButton } from "@/components/app/book/setup/carrier-terms-window-dialog";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { isRecordUuid } from "@/lib/ingestion/path";
import { loadCarrierCoverage } from "@/lib/pipelineRules/carrierCoverage";
import { carrierRulesHref, missingOf, unverifiedOf } from "@/lib/pipelineRules/carrierCoverageModel";

import { PENDING_HINT, PENDING_TITLE, TERMS_HREF, TERMS_INFO, factsOf, missingQueue, windowRows } from "./terms-rows";

/**
 * Carrier sync › Setup › Carrier terms (LA-4.17; round 7 board 1·B, "The terms grid", the owner's pick 2026-11-10):
 * one row a carrier the agency works with, one cell a window with its days or "+ Set". A cell opens that window's
 * dialog; the carrier's name opens its page (/app/book-setup/carrier-rules/[carrierId]). Windows · Money · Files are
 * the title line's tabs (?tab=), the same grid for the carrier's other facts. "Set the next window" steps through
 * every gap, the costliest first. Sorted by policies left without a countdown. The old ?carrier= link lands on that
 * carrier's page. Opening the page writes nothing.
 */
export default async function SetupCarrierRulesPage({ searchParams }: { searchParams: Promise<{ tab?: string; carrier?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Carrier terms" description="Rates, carrier terms and card-move rules for your book." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Carrier terms" detail="Setup is for the account owner and bookkeepers." />;
  const { tab: asked, carrier } = await searchParams;
  if (carrier && isRecordUuid(carrier)) redirect(carrierRulesHref(carrier));
  const tab: TermsTab = asked === "money" || asked === "files" ? asked : "windows";
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const view = await loadCarrierCoverage(tenantId);
  const info = <InfoTip label="About carrier terms" side="right">{TERMS_INFO}</InfoTip>;

  if (!view.available) {
    return (
      <DataInPage step="carrier-rules" chip={info}>
        <TableCard><EmptyState title={PENDING_TITLE} hint={PENDING_HINT} /></TableCard>
      </DataInPage>
    );
  }

  const rows: CoverageListRow[] = view.carriers.map((carrier) => ({
    carrierId: carrier.carrierId,
    carrierName: carrier.carrierName,
    inForce: carrier.inForce,
    missing: missingOf(carrier).length,
    unverified: unverifiedOf(carrier).length,
    windows: windowRows(carrier),
    ...factsOf(carrier),
  }));
  const tabs = (
    <ViewTabs
      label="Carrier terms views"
      value={tab}
      tabs={[{ key: "windows" as const, label: "Windows", href: TERMS_HREF }, { key: "money" as const, label: "Money", href: `${TERMS_HREF}?tab=money` }, { key: "files" as const, label: "Files", href: `${TERMS_HREF}?tab=files` }]}
    />
  );
  const actions = tab === "windows" && rows.length > 0 ? <WindowQueueButton queue={missingQueue(view.carriers)} asOf={view.asOf} readOnly={readOnly} label="Set the next window" /> : undefined;

  return (
    <DataInPage step="carrier-rules" chip={info} tabs={tabs} actions={actions}>
      <CarrierCoverageList rows={rows} tab={tab} asOf={view.asOf} readOnly={readOnly} />
    </DataInPage>
  );
}
