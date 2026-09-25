export const USER_STATUSES = ["pending_verification", "active", "inactive", "suspended"] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  pending_verification: "Pending verification",
  active: "Active",
  inactive: "Inactive",
  suspended: "Suspended",
};

/**
 * A label for whatever status the database actually holds — including values this app does not
 * model.
 *
 * `USER_STATUS_LABELS` is a `Record<UserStatus, string>` over four values, so
 * `USER_STATUS_LABELS[user.status]` returns `undefined` for anything else and React renders
 * nothing. On 2026-09-21 the live table held two such values — **`invited` (9 users) and
 * `deactivated` (4)** — and every one of those 13 rows displayed a completely blank Status column.
 * Confirmed in a browser, not inferred.
 *
 * `accountTone()` in status-chip.tsx already colours both, so the chip was rendering with the right
 * colour and no text; only the label map had fallen behind the data.
 *
 * This deliberately echoes the raw value rather than mapping `invited` onto
 * `pending_verification` or `deactivated` onto `inactive`. They look like the same states under
 * different spellings, and consolidating them is a data decision with a migration behind it — not
 * something to infer while fixing a blank cell. Showing what the database says is always honest;
 * showing nothing never is.
 */
export function userStatusLabel(status: string): string {
  const known = USER_STATUS_LABELS[status as UserStatus];
  if (known) return known;
  if (!status) return "Unknown";
  return status
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export const USER_STATUS_BADGE_CLASS: Record<UserStatus, string> = {
  pending_verification: "border-transparent bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
  active: "border-transparent bg-[var(--color-success)]/10 text-[var(--color-success)]",
  inactive: "border-transparent bg-muted text-muted-foreground",
  suspended: "border-transparent bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
};

// Whitelist — the sort param is interpolated into an ORDER BY, so it must never be free text.
export const USER_SORT_COLUMNS = [
  "name",
  "email",
  "tenant_name",
  "tenant_role",
  "plan_code",
  "status",
  "last_login_at",
  "created_at",
] as const;

export type UserSortColumn = (typeof USER_SORT_COLUMNS)[number];

export const USERS_PAGE_SIZE = 20;
