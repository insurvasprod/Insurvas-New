// Client-safe shapes for platform maintenance and announcements. Database access lives in
// ./service.ts, which is server-only.

export const MAINTENANCE_LEVELS = ["banner_only", "read_only", "locked"] as const;
export type MaintenanceLevel = (typeof MAINTENANCE_LEVELS)[number];
export type EffectiveMaintenanceLevel = "off" | MaintenanceLevel;

export const MAINTENANCE_LEVEL_LABELS: Record<MaintenanceLevel, string> = {
  banner_only: "Banner only",
  read_only: "Read only",
  locked: "Locked",
};

export const MAINTENANCE_LEVEL_HELP: Record<MaintenanceLevel, string> = {
  banner_only: "Show the warning while reads and writes continue normally.",
  read_only: "Allow login and reading, but refuse every tenant write with a clear message.",
  locked: "Block tenant login and show the maintenance page. Admin sessions still work.",
};

export const ANNOUNCEMENT_TYPES = ["info", "warning", "critical"] as const;
export type AnnouncementType = (typeof ANNOUNCEMENT_TYPES)[number];

export const ANNOUNCEMENT_TYPE_LABELS: Record<AnnouncementType, string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

export const ANNOUNCEMENT_AUDIENCES = [
  "all",
  "individual",
  "agency_no_teams",
  "agency_with_teams",
  "management",
] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const ANNOUNCEMENT_AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  all: "Everyone",
  individual: "Individual plans",
  agency_no_teams: "Agency (flat) plans",
  agency_with_teams: "Agency (with teams) plans",
  management: "Management plans",
};

export type MaintenanceRow = {
  id: number;
  level: MaintenanceLevel;
  message: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  updated_by: string | null;
  updated_at: string;
};

export type MaintenanceStatus = {
  level: EffectiveMaintenanceLevel;
  configuredLevel: MaintenanceLevel | null;
  message: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  scheduled: boolean;
};

export type Announcement = {
  id: string;
  message: string;
  type: AnnouncementType;
  audience: AnnouncementAudience;
  starts_at: string;
  ends_at: string;
  is_dismissible: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
