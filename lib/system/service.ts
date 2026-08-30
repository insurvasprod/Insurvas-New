import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementType,
  type MaintenanceLevel,
  type MaintenanceRow,
  type MaintenanceStatus,
} from "./constants";

const MAINTENANCE_COLUMNS = "id, level, message, scheduled_start, scheduled_end, updated_by, updated_at";
const ANNOUNCEMENT_COLUMNS = "id, message, type, audience, starts_at, ends_at, is_dismissible, created_by, created_at, updated_at";

let maintenanceCache: { at: number; row: MaintenanceRow | null } | null = null;
const MAINTENANCE_CACHE_TTL_MS = 5_000;

export function invalidateMaintenanceCache() {
  maintenanceCache = null;
}

export async function getStoredMaintenance(): Promise<MaintenanceRow | null> {
  if (maintenanceCache && Date.now() - maintenanceCache.at < MAINTENANCE_CACHE_TTL_MS) {
    return maintenanceCache.row;
  }

  const { data, error } = await getSupabaseServiceClient()
    .from("maintenance")
    .select(MAINTENANCE_COLUMNS)
    .eq("id", 1)
    .maybeSingle<MaintenanceRow>();

  if (error) {
    console.error("[maintenance] could not load maintenance state; treating it as off", error);
    maintenanceCache = { at: Date.now(), row: null };
    return null;
  }

  maintenanceCache = { at: Date.now(), row: data ?? null };
  return data ?? null;
}

/**
 * The effective state is derived on every read. A future scheduled window is banner-only so users
 * get advance warning; the configured level applies during the window and disappears after it.
 */
export async function getMaintenanceStatus(now = new Date()): Promise<MaintenanceStatus> {
  const row = await getStoredMaintenance();
  if (!row) {
    return {
      level: "off",
      configuredLevel: null,
      message: null,
      scheduledStart: null,
      scheduledEnd: null,
      scheduled: false,
    };
  }

  const start = row.scheduled_start ? new Date(row.scheduled_start) : null;
  const end = row.scheduled_end ? new Date(row.scheduled_end) : null;
  if (end && now >= end) {
    return {
      level: "off",
      configuredLevel: row.level,
      message: row.message,
      scheduledStart: row.scheduled_start,
      scheduledEnd: row.scheduled_end,
      scheduled: false,
    };
  }

  const beforeWindow = Boolean(start && now < start);
  return {
    level: beforeWindow ? "banner_only" : row.level,
    configuredLevel: row.level,
    message: row.message,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    scheduled: Boolean(start && end),
  };
}

export async function setMaintenance(
  input: {
    level: MaintenanceLevel | null;
    message?: string;
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
  },
  adminId: string,
): Promise<{ from: MaintenanceRow | null; to: MaintenanceRow | null }> {
  const supabase = getSupabaseServiceClient();
  const from = await getStoredMaintenance();

  if (!input.level) {
    const { error } = await supabase.from("maintenance").delete().eq("id", 1);
    if (error) throw new Error(`Could not turn maintenance off: ${error.message}`);
    invalidateMaintenanceCache();
    return { from, to: null };
  }

  const { data, error } = await supabase
    .from("maintenance")
    .upsert(
      {
        id: 1,
        level: input.level,
        message: input.message!.trim(),
        scheduled_start: input.scheduledStart ?? null,
        scheduled_end: input.scheduledEnd ?? null,
        updated_by: adminId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select(MAINTENANCE_COLUMNS)
    .single<MaintenanceRow>();
  if (error || !data) throw new Error(`Could not save maintenance: ${error?.message ?? "no row returned"}`);

  invalidateMaintenanceCache();
  return { from, to: data };
}

export async function listAnnouncements(): Promise<Announcement[]> {
  const { data, error } = await getSupabaseServiceClient()
    .from("announcements")
    .select(ANNOUNCEMENT_COLUMNS)
    .order("starts_at", { ascending: false });
  if (error) throw new Error(`Could not load announcements: ${error.message}`);
  return (data ?? []) as Announcement[];
}

export async function createAnnouncement(input: {
  message: string;
  type: AnnouncementType;
  audience: AnnouncementAudience;
  startsAt: string;
  endsAt: string;
  isDismissible: boolean;
  createdBy: string;
}): Promise<Announcement> {
  const { data, error } = await getSupabaseServiceClient()
    .from("announcements")
    .insert({
      message: input.message.trim(),
      type: input.type,
      audience: input.audience,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      is_dismissible: input.isDismissible,
      created_by: input.createdBy,
    })
    .select(ANNOUNCEMENT_COLUMNS)
    .single<Announcement>();
  if (error || !data) throw new Error(`Could not create announcement: ${error?.message ?? "no row returned"}`);
  return data;
}

export async function updateAnnouncement(id: string, input: {
  message: string;
  type: AnnouncementType;
  audience: AnnouncementAudience;
  startsAt: string;
  endsAt: string;
  isDismissible: boolean;
}): Promise<Announcement> {
  const { data, error } = await getSupabaseServiceClient()
    .from("announcements")
    .update({
      message: input.message.trim(),
      type: input.type,
      audience: input.audience,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      is_dismissible: input.isDismissible,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(ANNOUNCEMENT_COLUMNS)
    .single<Announcement>();
  if (error || !data) throw new Error(`Could not update announcement: ${error?.message ?? "not found"}`);
  return data;
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const { error } = await getSupabaseServiceClient().from("announcements").delete().eq("id", id);
  if (error) throw new Error(`Could not delete announcement: ${error.message}`);
}

/** Active announcements are filtered by the user's current plan type and stored dismissal state. */
export async function getActiveAnnouncements(userId: string, tenantId: string, now = new Date()): Promise<Announcement[]> {
  const supabase = getSupabaseServiceClient();
  const [{ data: announcements, error }, { data: subscription }] = await Promise.all([
    supabase
      .from("announcements")
      .select(ANNOUNCEMENT_COLUMNS)
      .lte("starts_at", now.toISOString())
      .gt("ends_at", now.toISOString())
      .order("starts_at", { ascending: false }),
    supabase
      .from("subscriptions")
      .select("plans(plan_type)")
      .eq("tenant_id", tenantId)
      .neq("status", "cancelled")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ plans: { plan_type: string } | null }>(),
  ]);
  if (error) throw new Error(`Could not load active announcements: ${error.message}`);

  const { data: dismissed } = await supabase
    .from("announcement_dismissals")
    .select("announcement_id")
    .eq("user_id", userId);
  const dismissedIds = new Set((dismissed ?? []).map((row) => row.announcement_id));
  const planType = subscription?.plans?.plan_type ?? null;

  return ((announcements ?? []) as Announcement[]).filter(
    (announcement) =>
      !dismissedIds.has(announcement.id) &&
      (announcement.audience === "all" || announcement.audience === planType),
  );
}

export async function dismissAnnouncement(id: string, userId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data: announcement, error: announcementError } = await supabase
    .from("announcements")
    .select("id, is_dismissible")
    .eq("id", id)
    .maybeSingle<{ id: string; is_dismissible: boolean }>();
  if (announcementError || !announcement) throw new Error("Announcement not found");
  if (!announcement.is_dismissible) throw new Error("This announcement cannot be dismissed");

  const { error } = await supabase.from("announcement_dismissals").upsert(
    { announcement_id: id, user_id: userId },
    { onConflict: "announcement_id,user_id" },
  );
  if (error) throw new Error(`Could not dismiss announcement: ${error.message}`);
}
