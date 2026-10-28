import { redirect } from "next/navigation";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { effectiveFeatures } from "@/lib/features/killSwitch";
import { getTeamSnapshot } from "@/lib/tenantTeam/service";
import { planHiddenSettingsSections } from "@/lib/tenantTeam/seats";
import { outboundLimitSnapshot } from "@/lib/metering/outbound";
import { PageHeader } from "@/components/ui/page-header";
import { getWorkspaceSnapshot } from "@/lib/settings/workspaceSnapshot";
import { AgentSettingsTabs } from "@/components/app/agent-settings-tabs";
import { SETTINGS_SECTIONS } from "@/lib/settings/sections";

/**
 * Settings (LA-8.1, Notion sprint): one surface for every setting, wherever it lives.
 *
 * Open to every role. Each section carries its own feature and role gate (lib/settings/sections.ts),
 * so a producer sees their profile and notifications, a bookkeeper also sees Accounting and Carrier
 * rules, and the owner sees the lot — what someone may not open is absent, not greyed out.
 */
export default async function SettingsPage() {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");
  const entitlement = await getEntitlement(context.tenantId);
  const owner = context.role === "owner";
  // Independent reads, fetched together. The team and workspace snapshots feed the owner's
  // in-page panels (Agency profile, Team & access) and nobody else's, so only an owner pays for them.
  const [granted, teamSnapshot, outboundLimits, workspace] = await Promise.all([
    effectiveFeatures(entitlement.features, context.tenantId),
    owner ? getTeamSnapshot(context.tenantId, entitlement) : null,
    owner ? outboundLimitSnapshot(context.tenantId) : null,
    owner ? getWorkspaceSnapshot(context.tenantId, entitlement.plan_code ?? null) : null,
  ]);
  // viewerId: Team & access shows no row action on your own row (the board's owner row).
  const team = teamSnapshot && outboundLimits ? { ...teamSnapshot, outboundLimits, viewerId: context.userId } : null;
  // On the moving ribbon, like the homes and the redesign boards (owner, 2026-10-26); the rail and
  // the cards above it are frosted glass, so the ribbon shows through.
  return (
    <div className="m-stagger portal-settings-page flex flex-col gap-6">
      <PageHeader title="Settings" />

      <AgentSettingsTabs team={team} workspace={workspace} tabs={SETTINGS_SECTIONS} hidden={planHiddenSettingsSections(entitlement.limits.max_seats)} granted={granted} role={context.role} readOnly={entitlement.access === "read_only"} />
    </div>
  );
}
