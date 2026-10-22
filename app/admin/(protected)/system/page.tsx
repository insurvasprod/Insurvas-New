import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { PageHeader } from "@/components/ui/page-header";
import { SystemSettingsPanel } from "@/components/admin/system-settings-panel";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { announcementState, canChangeMaintenance } from "@/lib/system/adminFormat";
import { MAINTENANCE_LEVEL_LABELS } from "@/lib/system/constants";
import { loadSystemAdminView } from "@/lib/system/adminView";

export default async function SystemPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone. Changing maintenance is narrower (super_admin only).
  if (!canAccessConfigurationSection(admin.role, "system")) redirect("/admin");

  const view = await loadSystemAdminView();
  const nowMs = new Date(view.nowIso).getTime();
  const states = view.announcements.map((item) => announcementState(item, nowMs));
  const live = states.filter((state) => state === "live").length;
  const scheduled = states.filter((state) => state === "scheduled").length;
  const expired = states.filter((state) => state === "expired").length;
  const level = view.status.level;
  // A level saved for later is configured but not yet in force.
  const pending = level === "off" && view.status.configuredLevel ? MAINTENANCE_LEVEL_LABELS[view.status.configuredLevel] : null;
  const unread = view.announcementsError ? "Could not load" : null;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {/* "Maintenance" to match the sidebar — it is what the screen is for, where "System" said
          nothing. The route stays /admin/system so existing links keep working. */}
      <PageHeader title="Maintenance" />
      <StatStrip label="Maintenance at a glance">
        <StatTile label="Maintenance" valueSize="text" value={level === "off" ? "Off" : MAINTENANCE_LEVEL_LABELS[level]} valueTone={level === "off" ? undefined : level === "banner_only" ? "warning" : "danger"} footnote={pending ? `${pending} scheduled` : level === "off" ? "customers unaffected" : "in force now"} />
        <StatTile label="Announcements live" value={unread ? "—" : live.toLocaleString("en-US")} valueTone={!unread && live > 0 ? "info" : undefined} footnote={unread ?? "shown to customers now"} />
        <StatTile label="Scheduled" value={unread ? "—" : scheduled.toLocaleString("en-US")} footnote={unread ?? "start later"} />
        <StatTile label="Ended" value={unread ? "—" : expired.toLocaleString("en-US")} footnote={unread ?? "past their end date"} />
      </StatStrip>
      <SystemSettingsPanel view={view} canChangeMaintenance={canChangeMaintenance(admin.role)} />
    </div>
  );
}
