import { guardPage } from "@/lib/entitlements/guardPage";
import { CarrierRulesWorkspace } from "@/components/app/carrier-rules-workspace";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { CARRIER_RULES_PENDING_MESSAGE, loadCarrierRules } from "@/lib/ingestion/carrierRulesStore";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

/**
 * Book of Business › Carrier rules (LA-4.17, Notion sprint): every per-carrier number the countdowns,
 * alerts and expected figures use — visibly incomplete until someone fills it in. Owner and
 * bookkeeper. Opening the page writes nothing.
 */
export default async function CarrierRulesPage() {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Carrier rules" description="Each carrier's save windows, grace periods, commission triggers and payout rules." />;
  if (!hasTenantPermission(guard.role, "statements.view")) return <RoleGateNotice featureLabel="Carrier rules" detail="Carrier rules are kept by the account owner or a bookkeeper." />;

  const readOnly = guard.entitlement.access === "read_only";
  const view = await loadCarrierRules({ plane: "agency", tenantId: guard.context.tenantId, userId: guard.context.userId });
  const missing = view.carriers.filter((row) => row.gaps.length > 0);
  const uncovered = view.carriers.filter((row) => row.rules.ongoing_payment?.windowDays == null).reduce((sum, row) => sum + (row.inForce ?? 0), 0);
  const unverified = view.carriers.reduce((sum, row) => sum + Object.values(row.rules).filter((rule) => rule && !rule.verified && rule.windowDays !== null).length, 0);

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader title="Carrier rules" description="How long each carrier gives to save a policy, and the rest of its rules." />
      {!view.available && <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{CARRIER_RULES_PENDING_MESSAGE}</div>}
      {view.available && (
        <StatStrip label="Carrier rule coverage">
          <StatTile label="Carriers missing a rule" value={missing.length.toLocaleString("en-US")} valueTone={missing.length ? "warning" : undefined} footnote={`of ${view.carriers.length.toLocaleString("en-US")}`} />
          <StatTile label="Policies with no save window" value={uncovered.toLocaleString("en-US")} valueTone={uncovered ? "warning" : undefined} footnote="in force, no ongoing-payment window" />
          <StatTile label="Unverified rules" value={unverified.toLocaleString("en-US")} footnote="used, and shown as unverified" />
        </StatStrip>
      )}
      {view.available && <CarrierRulesWorkspace carriers={view.carriers} plane="agency" endpoint="/api/app/carrier-rules" readOnly={readOnly} asOf={view.asOf} />}
    </div>
  );
}
