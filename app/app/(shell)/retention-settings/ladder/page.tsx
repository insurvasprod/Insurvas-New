import { guardPage } from "@/lib/entitlements/guardPage";
import { loadFlaggedWords, loadLadderRules } from "@/lib/retention/cases/rulesStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { LadderRulesBoard } from "@/components/app/retention/ladder-rules-board";
import { SettingsRouteFrame } from "@/components/app/settings/settings-route-frame";

/**
 * Settings › Retention › Ladder rules (owner 2026-11-05; docs/retention/SPEC.md): which facts from the carrier
 * files put a policy on the Retention ladder, and the two thresholds. Opened from Start here. Owner only.
 */
export default async function RetentionLadderRulesPage() {
  const guard = await guardPage("chargeback_radar");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Retention settings" description="Which file facts put a policy on the Retention ladder." />;
  if (guard.role !== "owner") return <RoleGateNotice featureLabel="Retention settings" detail="Only the owner changes what puts a policy on the Retention ladder." />;
  const [rules, words] = await Promise.all([loadLadderRules(guard.context.tenantId), loadFlaggedWords(guard.context.tenantId)]);
  return (
    <SettingsRouteFrame sectionId="retention">
      <div className="flex min-h-0 flex-grow flex-col gap-4">
        <LadderRulesBoard rules={rules} words={words} canEdit={guard.entitlement.access !== "read_only"} />
      </div>
    </SettingsRouteFrame>
  );
}
