import type { MaintenanceStatus } from "@/lib/system/constants";

export function MaintenanceMessage({ status }: { status: MaintenanceStatus }) {
  if (status.level === "off") return null;

  return (
    <div
      role="status"
      className={`mb-6 rounded-lg border p-4 text-sm ${
        status.level === "banner_only"
          ? "border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10"
          : "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10"
      }`}
    >
      <p className="font-semibold">
        {status.level === "banner_only" ? "Scheduled maintenance" : status.level === "read_only" ? "Platform is read-only" : "Platform maintenance"}
      </p>
      <p className="mt-1">{status.message}</p>
      {status.scheduledEnd && status.level !== "banner_only" && (
        <p className="mt-1 text-xs opacity-80">Expected end: {new Date(status.scheduledEnd).toLocaleString()}</p>
      )}
    </div>
  );
}
