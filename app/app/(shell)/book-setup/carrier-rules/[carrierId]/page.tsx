import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { CarrierFacts } from "@/components/app/book/setup/carrier-facts";
import { CarrierRuleWindows } from "@/components/app/book/setup/carrier-rule-windows";
import { CarrierTermsHistory } from "@/components/app/book/setup/carrier-terms-history";
import { WindowQueueButton } from "@/components/app/book/setup/carrier-terms-window-dialog";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { RULE_TYPES, type RuleType } from "@/lib/ingestion/carrierRules";
import { isRecordUuid } from "@/lib/ingestion/path";
import { loadCarrierRulesPage } from "@/lib/pipelineRules/carrierCoverage";

import { MONEY_FACTS, PENDING_HINT, PENDING_TITLE, TERMS_HREF, carrierTabHref, factsOf, policiesHref, triggerText, windowName, windowRows } from "../terms-rows";

type CarrierTab = "windows" | "money" | "files" | "history";
const TABS: CarrierTab[] = ["windows", "money", "files", "history"];

/**
 * Carrier sync › Setup › Carrier terms › a carrier (LA-4.17; round 7 boards 1·1–1·3, direction B): the carrier's name
 * alone on its line, its tabs Windows · Money · Files · History beside it (?tab=), and ‹ previous · next › naming the
 * carriers they open, in the grid's order (the tab is kept). Windows: a strip of its figures (each a link), then the
 * five windows; a row opens its window's dialog and "Set N windows" steps through the missing ones. Money and Files:
 * one row a fact, each opening its dialog or the page that keeps it. History: every saved window, filterable, read-only
 * (?window= filters it). Rule writes are new effective-dated rows; past countdowns keep theirs. Opening the page
 * writes nothing.
 */
export default async function CarrierRulesCarrierPage({ params, searchParams }: { params: Promise<{ carrierId: string }>; searchParams: Promise<{ tab?: string; window?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Carrier terms" description="Rates, carrier terms and card-move rules for your book." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Carrier terms" detail="Setup is for the account owner and bookkeepers." />;
  const [{ carrierId }, { tab: asked, window: askedWindow }] = await Promise.all([params, searchParams]);
  if (!isRecordUuid(carrierId)) notFound();
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const view = await loadCarrierRulesPage(tenantId, carrierId);
  if (!view.available) return <DataInPage step="carrier-rules" title="Carrier terms"><TableCard><EmptyState title={PENDING_TITLE} hint={PENDING_HINT} /></TableCard></DataInPage>;
  const carrier = view.carrier;
  if (!carrier) notFound();

  const tab: CarrierTab = TABS.includes(asked as CarrierTab) ? (asked as CarrierTab) : "windows";
  const rows = windowRows(carrier);
  const missing = rows.filter((row) => row.state === "missing");
  const unverified = rows.filter((row) => row.state === "unverified").length;
  const lines = RULE_TYPES.flatMap((type) => view.history[type]);
  const { settings, files } = factsOf(carrier);
  const moneyUnset = MONEY_FACTS.filter((field) => settings[field].value === null).length;

  const tabs = (
    <ViewTabs
      label={`${carrier.carrierName} terms`}
      value={tab}
      tabs={[
        { key: "windows" as const, label: "Windows", count: missing.length || null, tone: "danger" as const, href: carrierTabHref(carrier.carrierId, "windows") },
        { key: "money" as const, label: "Money", count: moneyUnset || null, tone: "danger" as const, href: carrierTabHref(carrier.carrierId, "money") },
        { key: "files" as const, label: "Files", href: carrierTabHref(carrier.carrierId, "files") },
        { key: "history" as const, label: "History", count: lines.length || null, href: carrierTabHref(carrier.carrierId, "history") },
      ]}
    />
  );
  const stepper = (view.previous || view.next) && (
    <>
      {view.previous && <Link href={carrierTabHref(view.previous.carrierId, tab)} className={buttonVariants({ variant: "outline" })} title={`Previous carrier: ${view.previous.carrierName}`}><ChevronLeft aria-hidden="true" />{view.previous.carrierName}</Link>}
      {view.next && <Link href={carrierTabHref(view.next.carrierId, tab)} className={buttonVariants({ variant: "outline" })} title={`Next carrier: ${view.next.carrierName}`}>{view.next.carrierName}<ChevronRight aria-hidden="true" /></Link>}
    </>
  );
  // Board 1·1: "Set 2 windows" on the Windows tab only; gone for a read-only account (a row still opens, read-only).
  const setWindows = tab === "windows" && !readOnly && missing.length > 0 && (
    <WindowQueueButton queue={missing.map((row) => ({ carrierId: carrier.carrierId, carrierName: carrier.carrierName, row }))} asOf={view.asOf} readOnly={readOnly} label={missing.length === 1 ? "Set the window" : `Set ${missing.length} windows`} />
  );
  const actions = (stepper || setWindows) ? <span className="inline-flex flex-wrap gap-2">{stepper}{setWindows}</span> : undefined;
  const trigger = triggerText(settings.commissionTrigger.value);
  const lag = settings.expectedLagDays.value;

  return (
    <DataInPage
      step="carrier-rules"
      title={carrier.carrierName}
      tabs={tabs}
      actions={actions}
      breadcrumbs={[{ label: "Carrier sync", href: "/app/needs-you" }, { label: "Carrier terms", href: TERMS_HREF }, { label: carrier.carrierName }]}
    >
      {tab === "windows" && (
        <div className="grid gap-4">
          {/* Board 1·1: the facts that sat under the title, as figures, each a link. */}
          <StatStrip label={`${carrier.carrierName} at a glance`}>
            <StatTile label="In force" valueSize="text" value={carrier.inForce.toLocaleString("en-US")} href={policiesHref(carrier.carrierId)} footnote="open them in Policies" />
            <StatTile label="Windows set" valueSize="text" value={`${RULE_TYPES.length - missing.length} of ${RULE_TYPES.length}`} footnote={missing.length ? <StatusChip tone="warning">{`${missing.length} not set`}</StatusChip> : "every window set"} />
            <StatTile label="Without a countdown" valueSize="text" value={(missing.length ? carrier.inForce : 0).toLocaleString("en-US")} footnote={missing.length ? (carrier.inForce ? <StatusChip tone="danger">{`No ${windowName(missing[0].type as RuleType).toLowerCase()} window`}</StatusChip> : `no ${windowName(missing[0].type as RuleType).toLowerCase()} window`) : "every policy counts down"} />
            <StatTile label="Unverified" valueSize="text" value={unverified.toLocaleString("en-US")} href={carrierTabHref(carrier.carrierId, "history")} footnote="seen in files, not checked" />
            <StatTile label="Pays commission" valueSize="text" value={trigger ?? "Not set"} href={carrierTabHref(carrier.carrierId, "money")} footnote={[lag === null ? "lag not set" : `${lag} days later`, settings.commissionTrigger.scope === "agency" ? "yours" : settings.commissionTrigger.scope === "platform" ? "Insurvas's" : null].filter(Boolean).join(" · ")} />
          </StatStrip>
          <CarrierRuleWindows carrierId={carrier.carrierId} carrierName={carrier.carrierName} asOf={view.asOf} readOnly={readOnly} rows={rows} />
        </div>
      )}
      {(tab === "money" || tab === "files") && (
        <CarrierFacts view={tab} carrierId={carrier.carrierId} carrierName={carrier.carrierName} readOnly={readOnly} settings={settings} files={files} desk={carrier.commissionsDesk} />
      )}
      {tab === "history" && (
        <CarrierTermsHistory key={askedWindow ?? "all"} lines={lines} asOf={view.asOf} initialWindow={(RULE_TYPES as readonly string[]).includes(askedWindow ?? "") ? (askedWindow as RuleType) : null} />
      )}
    </DataInPage>
  );
}
