import { SystemAnnouncements } from "@/components/admin/system-announcements";
import { SystemMaintenanceEditor } from "@/components/admin/system-maintenance-editor";
import { SystemMaintenanceStatus } from "@/components/admin/system-maintenance-status";
import type { SystemAdminView } from "@/lib/system/adminView";

/**
 * /admin/system (board p-adm-system), below the page header: the live status callout, the level
 * editor with its customer preview, then announcements.
 */
export function SystemSettingsPanel({ view, canChangeMaintenance }: { view: SystemAdminView; canChangeMaintenance: boolean }) {
  return (
    <>
      <SystemMaintenanceStatus status={view.status} stored={view.stored} lastChange={view.lastChange} />
      {/* Remounted whenever the saved state changes, so the form starts again from what is now true. */}
      <SystemMaintenanceEditor
        key={`${view.stored?.updated_at ?? "none"}:${view.status.level}`}
        stored={view.stored}
        status={view.status}
        nowIso={view.nowIso}
        canChange={canChangeMaintenance}
      />
      <SystemAnnouncements initialAnnouncements={view.announcements} loadError={view.announcementsError} nowIso={view.nowIso} />
    </>
  );
}
