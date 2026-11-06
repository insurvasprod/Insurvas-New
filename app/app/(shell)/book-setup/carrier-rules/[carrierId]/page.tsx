import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { CarrierFacts } from "@/components/app/book/setup/carrier-facts";
import { CarrierRuleWindows, type WindowRow, type WindowRule } from "@/components/app/book/setup/carrier-rule-windows";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Callout } from "@/components/app/settings/primitives";
import { buttonVariants } from "@/components/ui/button";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { RULE_TYPES, type ResolvedRule, type RuleRow } from "@/lib/ingestion/carrierRules";
import { CARRIER_RULES_PENDING_MESSAGE } from "@/lib/ingestion/carrierRulesStore";
import { isRecordUuid } from "@/lib/ingestion/path";
import { loadCarrierRulesPage } from "@/lib/pipelineRules/carrierCoverage";
import { carrierRulesHref, gapCost, missingOf, unverifiedOf } from "@/lib/pipelineRules/carrierCoverageModel";

const toWindow = (rule: ResolvedRule | RuleRow | null): WindowRule | null =>
  rule ? { id: rule.id, scope: rule.tenantId ? "agency" : "platform", windowDays: rule.windowDays, graceDays: rule.graceDays, redraftAttempts: rule.redraftAttempts, redraftIntervalDays: rule.redraftIntervalDays, source: rule.source, notes: rule.notes, effectiveFrom: rule.effectiveFrom, verified: Boolean(rule.verifiedAt) } : null;

/**
 * Book of business › Setup › Carrier rules › a carrier (LA-4.17; boards 9b, 9c): one carrier, one page, everything
 * about it, in the Setup frame. ‹ Carrier › steps through the list in its order without going back. The retention
 * windows (a missing one is a row naming its cost, with Set it), then the money facts and the file facts, each
 * saying whose value it is. Rule writes are new effective-dated rows; past countdowns keep theirs. Opening the
 * page writes nothing.
 */
export default async function CarrierRulesCarrierPage({ params }: { params: Promise<{ carrierId: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Carrier terms" description="Rates, carrier terms and card-move rules for your book." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Carrier terms" detail="Setup is for the account owner and bookkeepers." />;
  const { carrierId } = await params;
  if (!isRecordUuid(carrierId)) notFound();
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const view = await loadCarrierRulesPage(tenantId, carrierId);
  if (!view.available) return <DataInPage step="carrier-rules" title="Carrier terms"><Callout tone="warning" title={CARRIER_RULES_PENDING_MESSAGE} /></DataInPage>;
  const carrier = view.carrier;
  if (!carrier) notFound();

  const missing = missingOf(carrier).length;
  const unverified = unverifiedOf(carrier).length;
  const facts = [
    `${carrier.inForce.toLocaleString("en-US")} in force`,
    missing ? `${missing} ${missing === 1 ? "rule" : "rules"} missing` : "nothing missing",
    ...(unverified ? [`${unverified} unverified`] : []),
  ].join(" · ");
  const rows: WindowRow[] = RULE_TYPES.map((type) => {
    const rule = carrier.rules[type];
    return {
      type,
      state: rule.state,
      rule: toWindow(rule.inForce),
      insurvas: toWindow(rule.insurvas),
      upcoming: toWindow(rule.upcoming),
      cost: gapCost(type, carrier.inForce),
      history: view.history[type].map((line) => ({ id: line.id, effectiveFrom: line.effectiveFrom, scope: line.scope, cleared: line.cleared, windowDays: line.windowDays, graceDays: line.graceDays, source: line.source, notes: line.notes, verifiedAt: line.verifiedAt, by: line.by, verifiedBy: line.verifiedBy })),
    };
  });
  const stepper = (view.previous || view.next) && (
    <span className="inline-flex gap-2">
      {view.previous && <Link href={carrierRulesHref(view.previous.carrierId)} className={buttonVariants({ variant: "outline" })} title={view.previous.carrierName}><ChevronLeft aria-hidden="true" />Carrier</Link>}
      {view.next && <Link href={carrierRulesHref(view.next.carrierId)} className={buttonVariants({ variant: "outline" })} title={view.next.carrierName}>Carrier<ChevronRight aria-hidden="true" /></Link>}
    </span>
  );

  return (
    <DataInPage
      step="carrier-rules"
      title={carrier.carrierName}
      facts={facts}
      actions={stepper || undefined}
      breadcrumbs={[{ label: "Carrier sync", href: "/app/needs-you" },{ label: "Carrier terms", href: "/app/book-setup/carrier-rules" }, { label: carrier.carrierName }]}
    >
      <CarrierRuleWindows carrierId={carrier.carrierId} carrierName={carrier.carrierName} asOf={view.asOf} readOnly={readOnly} rows={rows} />
      <CarrierFacts
        carrierId={carrier.carrierId}
        readOnly={readOnly}
        settings={Object.fromEntries(Object.entries(carrier.settings).map(([field, s]) => [field, { value: s.value, scope: s.scope, since: s.since, yours: s.yours }])) as Parameters<typeof CarrierFacts>[0]["settings"]}
        files={{ layouts: carrier.layouts, portal: carrier.portal, guidance: carrier.guidance, referencePattern: carrier.referencePattern }}
        desk={carrier.commissionsDesk}
      />
    </DataInPage>
  );
}
