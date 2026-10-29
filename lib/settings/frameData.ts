import "server-only";

import { getEntitlement } from "@/lib/entitlements/get";
import { effectiveFeatures } from "@/lib/features/killSwitch";
import { outboundLimitSnapshot } from "@/lib/metering/outbound";
import { getWorkspaceSnapshot } from "@/lib/settings/workspaceSnapshot";
import type { TenantContext } from "@/lib/tenantAuth/requireTenant";
import { getTeamSnapshot } from "@/lib/tenantTeam/service";
import { planHiddenSettingsSections } from "@/lib/tenantTeam/seats";

/**
 * What the Settings frame needs to draw its menu, for /app/settings and for the sections with their
 * own route (Accounting, Retention, Compliance), so every Settings page shows the same menu
 * (settings-shell plan, Task 6). Independent reads, fetched together. The team and workspace
 * snapshots feed the owner's in-page panels and the menu's two badges, so only an owner pays for them.
 */
export async function loadSettingsFrame(context: TenantContext) {
  const entitlement = await getEntitlement(context.tenantId);
  const owner = context.role === "owner";
  const [granted, teamSnapshot, outboundLimits, workspace] = await Promise.all([
    effectiveFeatures(entitlement.features, context.tenantId),
    owner ? getTeamSnapshot(context.tenantId, entitlement) : null,
    owner ? outboundLimitSnapshot(context.tenantId) : null,
    owner ? getWorkspaceSnapshot(context.tenantId, entitlement.plan_code ?? null) : null,
  ]);
  // viewerId: Team & access shows no row action on your own row (the board's owner row).
  const team = teamSnapshot && outboundLimits ? { ...teamSnapshot, outboundLimits, viewerId: context.userId } : null;
  return {
    granted,
    team,
    workspace,
    role: context.role,
    hidden: planHiddenSettingsSections(entitlement.limits.max_seats),
    readOnly: entitlement.access === "read_only",
  };
}
