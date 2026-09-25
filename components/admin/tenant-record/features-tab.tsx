import type { TenantTabProps } from "@/components/admin/tenant-record/types";
import { FeaturesTabView, type KillStates } from "@/components/admin/tenant-record/features-tab-view";
import { fetchAllSwitches } from "@/lib/features/killSwitch";
import { isFeatureAvailable } from "@/lib/features/killSwitchRules";
import { fetchTenantFeatureState } from "@/lib/tenantFeatureOverrides/queries";

/**
 * Feature overrides tab (board p-adm-tenant-features).
 *
 * What the plan (plus attached add-ons) grants this tenant, what staff switched on or off for it
 * alone, and the form to add or remove one. Reads one RPC (admin_tenant_feature_overrides, with a
 * table fallback until 20260924344000 is applied) and the platform kill switches, which still win
 * over any override and are shown so nobody reads "On" for a feature that is off for everyone.
 */
export async function TenantFeaturesTab({ tenantId, admin }: TenantTabProps) {
  const [state, switches] = await Promise.all([fetchTenantFeatureState(tenantId), fetchAllSwitches()]);

  if (!state) {
    // The frame has already resolved the tenant; this is a tenant deleted between the two reads.
    return <p className="text-[14px] text-[var(--muted)]">This tenant no longer exists.</p>;
  }

  const kill: KillStates = {};
  for (const [key, featureSwitch] of switches) {
    if (featureSwitch.state === "on" || isFeatureAvailable(featureSwitch, tenantId)) continue;
    kill[key] = featureSwitch.state === "off" ? "off" : "beta";
  }

  return <FeaturesTabView tenantId={tenantId} role={admin.role} state={state} kill={kill} />;
}
