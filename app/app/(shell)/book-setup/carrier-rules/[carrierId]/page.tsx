import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Suspense } from "react";

import { DataInPage, RecordName } from "@/components/app/data-in/data-in-page";
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
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { RULE_TYPES, type RuleType } from "@/lib/ingestion/carrierRules";
import { isRecordUuid } from "@/lib/ingestion/path";
import { loadCarrierRulesPage } from "@/lib/pipelineRules/carrierCoverage";

import { MONEY_FACTS, PENDING_HINT, PENDING_TITLE, TERMS_HREF, carrierTabHref, factsOf, policiesHref, triggerText, windowName, windowRows } from "../terms-rows";
import { IntentLink } from "@/components/ui/nav-pending";

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
  const tab: CarrierTab = TABS.includes(asked as CarrierTab) ? (asked as CarrierTab) : "windows";
  // Frame first (UI-CONSISTENCY §7a): the trail, the tabs and the frame draw at once; the carrier's name waits behind
  // its shape, and the counts, the buttons and the tab stream in.
  const read = loadCarrierRulesPage(tenantId, carrierId);
  const name = read.then((view) => (view.available ? view.carrier?.carrierName : "Carrier terms"));

  return (
    <DataInPage
      step="carrier-rules"
      title={<RecordName read={name} />}
      tabs={<Suspense fallback={<CarrierTabs carrierId={carrierId} tab={tab} />}><CountedTabs read={read} carrierId={carrierId} tab={tab} /></Suspense>}
      actions={<Suspense fallback={null}><Actions read={read} tab={tab} readOnly={readOnly} /></Suspense>}
      breadcrumbs={[{ label: "Carrier sync", href: "/app/needs-you" }, { label: "Carrier terms", href: TERMS_HREF }, { label: "Carrier", node: <RecordName read={name} crumb /> }]}
    >
      <StreamSection shape={tab === "windows" ? "strip+table" : tab === "history" ? "table" : "form"}>
        <CarrierTerms read={read} tab={tab} readOnly={readOnly} askedWindow={askedWindow} />
      </StreamSection>
    </DataInPage>
  );
}

type Read = ReturnType<typeof loadCarrierRulesPage>;
type Ready = Extract<Awaited<Read>, { available: true }>;
type Carrier = NonNullable<Ready["carrier"]>;

/** What every block works out from the carrier: its windows, the ones not set, its facts. */
function factsFor(view: Ready, carrier: Carrier) {
  const rows = windowRows(carrier);
  const missing = rows.filter((row) => row.state === "missing");
  const unverified = rows.filter((row) => row.state === "unverified").length;
  const lines = RULE_TYPES.flatMap((type) => view.history?.[type] ?? []);
  const { settings, files } = factsOf(carrier);
  const moneyUnset = MONEY_FACTS.filter((field) => settings[field].value === null).length;
  return { rows, missing, unverified, lines, settings, files, moneyUnset };
}

/** The carrier's tabs; without counts (while they load), the same tabs with none. */
function CarrierTabs({ carrierId, tab, name, counts }: { carrierId: string; tab: CarrierTab; name?: string; counts?: { missing: number; moneyUnset: number; history: number } }) {
  return (
    <ViewTabs
      label={name ? `${name} terms` : "Carrier terms"}
      value={tab}
      tabs={[
        { key: "windows" as const, label: "Windows", count: counts?.missing || null, tone: "danger" as const, href: carrierTabHref(carrierId, "windows") },
        { key: "money" as const, label: "Money", count: counts?.moneyUnset || null, tone: "danger" as const, href: carrierTabHref(carrierId, "money") },
        { key: "files" as const, label: "Files", href: carrierTabHref(carrierId, "files") },
        { key: "history" as const, label: "History", count: counts?.history || null, href: carrierTabHref(carrierId, "history") },
      ]}
    />
  );
}

async function CountedTabs({ read, carrierId, tab }: { read: Read; carrierId: string; tab: CarrierTab }) {
  const view = await read;
  if (!view.available) return null;
  const carrier = view.carrier;
  if (!carrier) return <CarrierTabs carrierId={carrierId} tab={tab} />;
  const { missing, moneyUnset, lines } = factsFor(view, carrier);
  return <CarrierTabs carrierId={carrier.carrierId} tab={tab} name={carrier.carrierName} counts={{ missing: missing.length, moneyUnset, history: lines.length }} />;
}

async function Actions({ read, tab, readOnly }: { read: Read; tab: CarrierTab; readOnly: boolean }) {
  const view = await read;
  if (!view.available || !view.carrier) return null;
  const carrier = view.carrier;
  const { missing } = factsFor(view, carrier);
  const stepper = (view.previous || view.next) && (
    <>
      {view.previous && <IntentLink transitionTypes={["nav-back"]} href={carrierTabHref(view.previous.carrierId, tab)} className={buttonVariants({ variant: "outline" })} title={`Previous carrier: ${view.previous.carrierName}`}><ChevronLeft aria-hidden="true" />{view.previous.carrierName}</IntentLink>}
      {view.next && <IntentLink transitionTypes={["nav-forward"]} href={carrierTabHref(view.next.carrierId, tab)} className={buttonVariants({ variant: "outline" })} title={`Next carrier: ${view.next.carrierName}`}>{view.next.carrierName}<ChevronRight aria-hidden="true" /></IntentLink>}
    </>
  );
  // Board 1·1: "Set 2 windows" on the Windows tab only; gone for a read-only account (a row still opens, read-only).
  const setWindows = tab === "windows" && !readOnly && missing.length > 0 && (
    <WindowQueueButton queue={missing.map((row) => ({ carrierId: carrier.carrierId, carrierName: carrier.carrierName, row }))} asOf={view.asOf} readOnly={readOnly} label={missing.length === 1 ? "Set the window" : `Set ${missing.length} windows`} />
  );
  return (stepper || setWindows) ? <span className="inline-flex flex-wrap gap-2">{stepper}{setWindows}</span> : null;
}

async function CarrierTerms({ read, tab, readOnly, askedWindow }: { read: Read; tab: CarrierTab; readOnly: boolean; askedWindow: string | undefined }) {
  const view = await read;
  if (!view.available) return <TableCard><EmptyState title={PENDING_TITLE} hint={PENDING_HINT} /></TableCard>;
  const carrier = view.carrier;
  if (!carrier) notFound();
  const { rows, missing, unverified, lines, settings, files } = factsFor(view, carrier);
  const trigger = triggerText(settings.commissionTrigger.value);
  const lag = settings.expectedLagDays.value;

  if (tab === "windows") {
    return (
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
    );
  }
  if (tab === "money" || tab === "files") {
    return <CarrierFacts view={tab} carrierId={carrier.carrierId} carrierName={carrier.carrierName} readOnly={readOnly} settings={settings} files={files} desk={carrier.commissionsDesk} />;
  }
  return <CarrierTermsHistory key={askedWindow ?? "all"} lines={lines} asOf={view.asOf} initialWindow={(RULE_TYPES as readonly string[]).includes(askedWindow ?? "") ? (askedWindow as RuleType) : null} />;
}
