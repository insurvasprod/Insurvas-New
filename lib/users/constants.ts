export const USER_STATUSES = ["pending_verification", "active", "inactive", "suspended"] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  pending_verification: "Pending verification",
  active: "Active",
  inactive: "Inactive",
  suspended: "Suspended",
};

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
