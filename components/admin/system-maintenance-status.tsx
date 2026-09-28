import { Callout, type Tone } from "@/components/app/settings/primitives";
import { DashboardUtcTime } from "@/components/admin/dashboard-utc-time";
import { MAINTENANCE_LEVEL_LABELS, type MaintenanceRow, type MaintenanceStatus } from "@/lib/system/constants";
import { utcDateTime } from "@/lib/system/adminFormat";
import type { MaintenanceLastChange } from "@/lib/system/adminView";

/**
 * The board's status callout: what is true for customers RIGHT NOW (the effective level, after the
 * scheduled window is applied), not what the unsaved form below says.
 */
export function SystemMaintenanceStatus({
  status,
  stored,
  lastChange,
}: {
  status: MaintenanceStatus;
  stored: MaintenanceRow | null;
  lastChange: MaintenanceLastChange | null;
}) {
  let tone: Tone = "success";
  let title = "Maintenance is off — the platform is fully available";
  let detail: string | null = null;

  const upcoming = status.level === "banner_only" && stored && stored.level !== "banner_only" && status.scheduledStart;
  if (status.level === "off") {
    if (stored?.scheduled_end) detail = `The last scheduled window ended ${utcDateTime(stored.scheduled_end)}.`;
  } else if (upcoming) {
    tone = "warning";
    title = `Maintenance is scheduled — customers see a banner until ${utcDateTime(status.scheduledStart)}`;
    detail = `From then the platform is ${MAINTENANCE_LEVEL_LABELS[stored.level].toLowerCase()}${status.scheduledEnd ? ` until ${utcDateTime(status.scheduledEnd)}` : ""}.`;
  } else if (status.level === "banner_only") {
    tone = "warning";
    title = "A maintenance banner is showing to every customer";
  } else if (status.level === "read_only") {
    tone = "error";
    title = "The platform is read only — customers cannot save anything right now";
  } else {
    tone = "error";
    title = "The platform is locked — customers are shut out right now";
  }
  if (status.level !== "off" && !upcoming && status.scheduledEnd) {
    detail = `It clears automatically at ${utcDateTime(status.scheduledEnd)}.`;
  }

  return (
    <Callout tone={tone} title={title}>
      {detail && <p className="m-0">{detail}</p>}
      {lastChange && (
        <p className={`m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] ${detail ? "mt-1.5" : ""}`}>
          Last changed <DashboardUtcTime iso={lastChange.at} text={utcDateTime(lastChange.at)} />
          {lastChange.actorName ? ` by ${lastChange.actorName}` : ""}
          {lastChange.reason ? ` — “${lastChange.reason}”` : ""}
        </p>
      )}
    </Callout>
  );
}
