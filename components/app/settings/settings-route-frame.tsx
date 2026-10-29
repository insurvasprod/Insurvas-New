import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AgentSettingsTabs } from "@/components/app/agent-settings-tabs";
import { loadSettingsFrame } from "@/lib/settings/frameData";
import { SETTINGS_SECTIONS } from "@/lib/settings/sections";
import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";

/**
 * A Settings section with its own route (Accounting, Retention, Compliance) inside the one Settings
 * layout: the same header, breadcrumb and menu as /app/settings, with this section active and the
 * module's own board as the content (settings-shell plan, Task 6). The page keeps its own gates; this
 * only draws the frame around what it renders.
 */
export async function SettingsRouteFrame({ sectionId, children }: { sectionId: string; children: ReactNode }) {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");
  const frame = await loadSettingsFrame(context);
  return (
    <div className="m-stagger portal-settings-page flex min-h-0 flex-grow flex-col gap-6">
      <AgentSettingsTabs tabs={SETTINGS_SECTIONS} team={frame.team} workspace={frame.workspace} hidden={frame.hidden} granted={frame.granted} role={frame.role} readOnly={frame.readOnly} routeSection={sectionId}>
        {children}
      </AgentSettingsTabs>
    </div>
  );
}
