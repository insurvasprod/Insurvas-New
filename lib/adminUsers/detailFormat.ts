// Display helpers for the admin user record (board p-adm-user-detail). Plain module with no imports,
// so the server page, its client islands and node:test can all load it.

export const USER_DETAIL_TABS = [
  { key: "login", label: "Login activity" },
  { key: "sessions", label: "Sessions" },
  { key: "audit", label: "Audit" },
] as const;

export type UserDetailTabKey = (typeof USER_DETAIL_TABS)[number]["key"];

export function userDetailTabFrom(value: string | string[] | undefined): UserDetailTabKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return USER_DETAIL_TABS.some((tab) => tab.key === raw) ? (raw as UserDetailTabKey) : "login";
}

/** `?page=` as a positive integer; anything else is page 1. */
export function pageFrom(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  return Math.max(1, Math.floor(Number(raw)) || 1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "4 Jan 2026". UTC, so the server and the browser print the same day. */
export function utcDate(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : "—";
}

/** "18 Sep 2026 14:02 UTC" — the fact card's time. */
export function utcDateTime(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? `${utcDate(iso)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC` : "—";
}

export type DetailPillTone = "success" | "warning" | "error" | "info" | "neutral";

/**
 * The status pill's colour. Red for suspended (the board), because this is the record an operator
 * opens to find out why someone cannot get in. Deliberate states that end access (inactive,
 * deactivated) are neutral; invitations not yet accepted are info.
 */
export function userStatusTone(status: string | null | undefined): DetailPillTone {
  switch (status) {
    case "active":
      return "success";
    case "suspended":
    case "deleted":
      return "error";
    case "invited":
    case "pending_verification":
      return "info";
    default:
      return "neutral";
  }
}
