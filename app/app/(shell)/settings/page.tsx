import { redirect } from "next/navigation";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { AgentSettingsTabs } from "@/components/app/agent-settings-tabs";
import { loadSettingsFrame } from "@/lib/settings/frameData";
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
  // The same reads as a routed section's frame (lib/settings/frameData.ts), so every Settings page
  // draws the same menu. The page header (breadcrumb, the open section's title, its purpose) is drawn
  // by the frame itself, since it follows the section picked in the menu (settings-shell plan).
  const frame = await loadSettingsFrame(context);
  return (
    <div className="m-stagger portal-settings-page flex flex-col gap-6">
      <AgentSettingsTabs team={frame.team} workspace={frame.workspace} tabs={SETTINGS_SECTIONS} hidden={frame.hidden} granted={frame.granted} role={frame.role} readOnly={frame.readOnly} />
    </div>
  );
}
