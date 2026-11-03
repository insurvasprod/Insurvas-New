/**
 * Admin › Users list: wording. Plain module — the client island renders with it and the tests pin it.
 */
import type { UsersListStats } from "./types.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "22 Sep 08:12 UTC", or "2 Aug 2025 11:40 UTC" outside the reading year. UTC and spelled out, so
 * the server render and the browser print the same text; `now` is the page's read time, for the
 * same reason.
 */
export function loginCell(iso: string | null | undefined, now: number): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const year = date.getUTCFullYear() === new Date(now).getUTCFullYear() ? "" : ` ${date.getUTCFullYear()}`;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}${year} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/** "22 Sep 2026" — the join date under a name's hover. */
export function dayCell(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

const SORT_WORDS: Record<string, [asc: string, desc: string]> = {
  created_at: ["oldest first", "newest first"],
  last_login_at: ["earliest login first", "latest login first"],
  name: ["by name, A to Z", "by name, Z to A"],
  email: ["by email, A to Z", "by email, Z to A"],
  tenant_name: ["by tenant, A to Z", "by tenant, Z to A"],
  tenant_role: ["by role", "by role, reversed"],
  plan_code: ["by plan, A to Z", "by plan, Z to A"],
  status: ["by status", "by status, reversed"],
};

/** The footer's order, which must be the order the query really uses. */
export function orderLabel(sort: string, dir: "asc" | "desc"): string {
  const words = SORT_WORDS[sort];
  if (!words) return "";
  // Never-signed-in people have no login time and sort last in both directions (nullsFirst: false).
  const tail = sort === "last_login_at" ? ", never signed in last" : "";
  return `${dir === "asc" ? words[0] : words[1]}${tail}`;
}

export const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "created_at", label: "Joined" },
  { value: "name", label: "Name" },
  { value: "email", label: "Email" },
  { value: "tenant_name", label: "Tenant" },
  { value: "tenant_role", label: "Role" },
  { value: "plan_code", label: "Plan" },
  { value: "status", label: "Status" },
  { value: "last_login_at", label: "Last login" },
];

const pct = (part: number, whole: number) => {
  if (whole === 0) return "0%";
  const value = (part / whole) * 100;
  return `${value >= 99.95 || value === 0 ? Math.round(value) : value.toFixed(1)}%`;
};

export type TileText = { value: string; footnote: string; title?: string };

/** The four tiles' figures and footnotes, from real counts — never the board's samples. */
export function tileText(stats: UsersListStats): { users: TileText; active: TileText; invited: TileText; suspended: TileText } {
  const n = (value: number) => value.toLocaleString("en-US");
  const tenantWord = `${n(stats.tenants)} tenant${stats.tenants === 1 ? "" : "s"}`;
  return {
    users: {
      value: n(stats.rows),
      footnote: stats.tenantless ? `across ${tenantWord}, ${n(stats.tenantless)} in none` : `across ${tenantWord}`,
      title: "One row per person per tenant; a person who belongs to no tenant is one row. Deleted people are not counted.",
    },
    active: {
      value: n(stats.active),
      footnote: pct(stats.active, stats.rows),
      title: "Can sign in, and has accepted their place in the tenant.",
    },
    invited: {
      value: n(stats.invited),
      footnote: stats.invited === 0 ? "none waiting" : stats.invitedStale ? `${n(stats.invitedStale)} over 7 days old` : "none over 7 days old",
      title: "Invited and not accepted yet. An invite holds a seat from the moment it is sent.",
    },
    suspended: {
      value: n(stats.suspended),
      footnote:
        stats.suspended === 0
          ? "none right now"
          : stats.suspendedNoReason
            ? `${n(stats.suspendedNoReason)} without a reason`
            : stats.suspended === 1
              ? "with a reason"
              : "each with a reason",
      title: "Signed out and blocked until the suspension is lifted. Still holds a seat.",
    },
  };
}
