import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Announcement, MaintenanceRow, MaintenanceStatus } from "./constants";
import { getMaintenanceStatus, getStoredMaintenance, listAnnouncements } from "./service";

export type MaintenanceLastChange = {
  at: string;
  actorName: string | null;
  reason: string | null;
  toLevel: string | null;
};

export type SystemAdminView = {
  stored: MaintenanceRow | null;
  status: MaintenanceStatus;
  lastChange: MaintenanceLastChange | null;
  announcements: Announcement[];
  announcementsError: string | null;
  nowIso: string;
};

/**
 * The newest maintenance.updated audit row, with the staff member's name. The maintenance row is
 * deleted when maintenance is turned off, so the audit log is the only place "who turned it off,
 * when, and why" survives. Display-only: any failure is simply no line.
 */
async function lastMaintenanceChange(): Promise<MaintenanceLastChange | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("ts, actor_id, reason, metadata")
    .eq("action", "maintenance.updated")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle<{ ts: string; actor_id: string | null; reason: string | null; metadata: unknown }>();
  if (error || !data) return null;

  let actorName: string | null = null;
  if (data.actor_id) {
    const { data: admin } = await supabase
      .from("admin_users")
      .select("name, email")
      .eq("id", data.actor_id)
      .maybeSingle<{ name: string | null; email: string | null }>();
    actorName = admin?.name?.trim() || admin?.email || null;
  }

  const changes = (data.metadata as { changes?: { level?: { to?: unknown } } } | null)?.changes;
  const toLevel = typeof changes?.level?.to === "string" ? changes.level.to : null;
  return { at: data.ts, actorName, reason: data.reason, toLevel };
}

export async function loadSystemAdminView(): Promise<SystemAdminView> {
  const [stored, status, lastChange, announcements] = await Promise.all([
    getStoredMaintenance(),
    getMaintenanceStatus(),
    lastMaintenanceChange().catch(() => null),
    listAnnouncements().then(
      (rows) => ({ rows, error: null as string | null }),
      (error: unknown) => ({ rows: [] as Announcement[], error: error instanceof Error ? error.message : "Could not load announcements" }),
    ),
  ]);
  return {
    stored,
    status,
    lastChange,
    announcements: announcements.rows,
    announcementsError: announcements.error,
    nowIso: new Date().toISOString(),
  };
}
