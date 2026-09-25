// Client-safe helpers for the staff Maintenance screen (/admin/system, board p-adm-system).
// Plain module: the server page and the client islands both read it, so it imports nothing.

/** Who may change maintenance mode. Opening the screen is wider (super_admin + platform_config). */
export const CAN_CHANGE_MAINTENANCE = ["super_admin"] as const;

export function canChangeMaintenance(role: string): boolean {
  return (CAN_CHANGE_MAINTENANCE as readonly string[]).includes(role);
}

export const MAINTENANCE_REASON_MIN = 5;
export const MAINTENANCE_REASON_MAX = 500;

/**
 * What a super admin types before locking the platform. It names the effect rather than being a
 * generic "CONFIRM", so nobody can do it on autopilot.
 */
export const LOCK_CONFIRM_PHRASE = "lock every workspace";

export function confirmsLock(input: string): boolean {
  return input.trim().replace(/\s+/g, " ").toLowerCase() === LOCK_CONFIRM_PHRASE;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * An ISO instant as the value of a datetime-local input, read in UTC. Every time on the staff
 * console is UTC, so the inputs are too — a browser-local input would silently shift by the
 * reader's offset between what they typed and what customers are told.
 */
export function toUtcInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** The inverse of toUtcInput. Empty or unreadable input is null. */
export function fromUtcInput(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return null;
  const date = new Date(`${trimmed.length === 16 ? `${trimmed}:00` : trimmed}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Built by hand rather than with Intl: ICU versions disagree on "Sep" vs "Sept", and the server and
// the browser printing different text is a hydration mismatch.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MONTH = { format: (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` };
const DAY = { format: (d: Date) => `${DAY_MONTH.format(d)} ${d.getUTCFullYear()}` };
const TIME = { format: (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };

function valid(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "22 Sep 2026 03:00 UTC". Also used by the customer-facing /maintenance page and the in-app
 * maintenance banner, so staff preview and customers read the same string.
 */
export function utcDateTime(iso: string | null | undefined): string {
  const date = valid(iso);
  return date ? `${DAY.format(date)} ${TIME.format(date)} UTC` : "—";
}

/** "20 Sep – 4 Oct 2026"; "21 Sep 2026" for a one-day window; both years when they differ. */
export function announcementWindow(startIso: string, endIso: string): string {
  const start = valid(startIso);
  const end = valid(endIso);
  if (!start || !end) return "—";
  const startDay = DAY.format(start);
  const endDay = DAY.format(end);
  if (startDay === endDay) return endDay;
  if (start.getUTCFullYear() === end.getUTCFullYear()) return `${DAY_MONTH.format(start)} – ${endDay}`;
  return `${startDay} – ${endDay}`;
}

export type AnnouncementState = "live" | "scheduled" | "expired";

/** The same rule customers are served by: live from starts_at (inclusive) until ends_at (exclusive). */
export function announcementState(item: { starts_at: string; ends_at: string }, nowMs: number): AnnouncementState {
  if (new Date(item.ends_at).getTime() <= nowMs) return "expired";
  if (new Date(item.starts_at).getTime() > nowMs) return "scheduled";
  return "live";
}

export type MaintenanceDraftInput = {
  level: "off" | "banner_only" | "read_only" | "locked";
  message: string;
  start: string;
  end: string;
};

/**
 * What stops a maintenance change from being sent, or null. The route re-checks the parts it owns;
 * "the end has already passed" is the screen's alone, because a window that is over the moment it
 * is saved would look saved and change nothing.
 */
export function maintenanceDraftError(draft: MaintenanceDraftInput, nowMs: number): string | null {
  if (draft.level === "off") return null;
  if (!draft.message.trim()) return "Enter the message customers will see.";
  if (draft.message.trim().length > 1000) return "Keep the message to 1,000 characters.";
  const start = draft.start ? fromUtcInput(draft.start) : null;
  const end = draft.end ? fromUtcInput(draft.end) : null;
  if (draft.start && !start) return "The scheduled start is not a valid date and time.";
  if (draft.end && !end) return "The scheduled end is not a valid date and time.";
  if (start && !end) return "Choose a scheduled end as well, or clear the start.";
  if (end && new Date(end).getTime() <= nowMs) return "The scheduled end has already passed.";
  if (start && end && new Date(end) <= new Date(start)) return "The scheduled end must be after the start.";
  return null;
}
