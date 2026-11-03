/**
 * The staff-accounts screen (board p-adm-admins): the tiles, the order, the dates, and the one rule
 * for which change to a staff account may be made. Plain module: the server page, the client table
 * and PATCH /api/admin/admins/[id] all read it, so the menu can never offer what the route refuses.
 */
import { ADMIN_ROLE_LABELS, type AdminRole } from "../adminAuth/roles.ts";

export type StaffRow = {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
};

export type StaffChange = { role?: AdminRole; is_active?: boolean };

export type StaffSummary = {
  total: number;
  deactivated: number;
  superAdmins: number;
  activeSuperAdmins: number;
  billingAdmins: number;
  billingDeactivated: number;
  supportAgents: number;
  supportDeactivated: number;
  platformConfig: number;
};

export function staffSummary(rows: readonly StaffRow[]): StaffSummary {
  const of = (role: AdminRole) => rows.filter((row) => row.role === role);
  const billing = of("billing_admin");
  const support = of("support_agent");
  const supers = of("super_admin");
  return {
    total: rows.length,
    deactivated: rows.filter((row) => !row.is_active).length,
    superAdmins: supers.length,
    activeSuperAdmins: supers.filter((row) => row.is_active).length,
    billingAdmins: billing.length,
    billingDeactivated: billing.filter((row) => !row.is_active).length,
    supportAgents: support.length,
    supportDeactivated: support.filter((row) => !row.is_active).length,
    platformConfig: of("platform_config").length,
  };
}

/** "1 deactivated", plus the platform-config count when there is one (it has no tile of its own). */
export function adminsFootnote(summary: StaffSummary): string {
  const parts = [`${summary.deactivated} deactivated`];
  if (summary.platformConfig > 0) parts.push(`${summary.platformConfig} platform config`);
  return parts.join(" · ");
}

/** A role tile's footnote: how many of them are deactivated, or the board's dash when none are. */
export function roleFootnote(deactivated: number): string {
  return deactivated > 0 ? `${deactivated} deactivated` : "—";
}

/** The footer says exactly this, so it must stay the order sortStaff produces. */
export const STAFF_ORDER = "super admins first, then oldest first";

/** Super admins first, then everyone else; each group oldest account first (then email, for ties). */
export function sortStaff<T extends Pick<StaffRow, "role" | "created_at" | "email">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const rank = Number(b.role === "super_admin") - Number(a.role === "super_admin");
    if (rank !== 0) return rank;
    const at = Date.parse(a.created_at) - Date.parse(b.created_at);
    if (at !== 0 && !Number.isNaN(at)) return at;
    return a.email.localeCompare(b.email);
  });
}

// Spelled out rather than left to Intl: ICU versions disagree on en-GB's short September ("Sep" /
// "Sept"), and a server and a browser that disagree is a hydration mismatch.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function day(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "22 Sep 2026 08:40:55 UTC". Fixed zone and spelling, so the server render and the browser agree. */
export function staffDateTime(iso: string | null | undefined): string | null {
  const date = parse(iso);
  if (!date) return null;
  return `${day(date)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

/** "4 Jan 2026" (UTC). */
export function staffDate(iso: string | null | undefined): string | null {
  const date = parse(iso);
  return date ? day(date) : null;
}

/** The staff role label, lower-cased for the middle of a sentence: "a billing admin". */
export function roleInSentence(role: AdminRole): string {
  return ADMIN_ROLE_LABELS[role].toLowerCase();
}

const WITH_ARTICLE: Record<AdminRole, string> = {
  super_admin: "a super admin",
  support_agent: "a support agent",
  billing_admin: "a billing admin",
  platform_config: "a platform config admin",
};

/** "a billing admin", "a platform config admin": the role as the object of a sentence. */
export function roleWithArticle(role: AdminRole): string {
  return WITH_ARTICLE[role];
}

export const SELF_REFUSAL = "This is your account. Another super admin has to change it.";
export const LAST_SUPER_ADMIN_REFUSAL =
  "This is the only active super admin. Make someone else a super admin first — without one, nobody could manage staff accounts from this console.";

/** Would this change leave the target no longer an active super admin? */
export function removesActiveSuperAdmin(target: Pick<StaffRow, "role" | "is_active">, change: StaffChange): boolean {
  if (target.role !== "super_admin" || !target.is_active) return false;
  const nextRole = change.role ?? target.role;
  const nextActive = change.is_active ?? target.is_active;
  return nextRole !== "super_admin" || !nextActive;
}

/**
 * Why this change may not be made, or null when it may. The route re-checks it against a fresh
 * read, and 20260924353000's trigger holds the last rule in the database itself, where two
 * super admins acting at the same moment cannot both pass it.
 */
export function staffChangeRefusal({
  actorId,
  target,
  change,
  activeSuperAdmins,
}: {
  actorId: string;
  target: Pick<StaffRow, "id" | "role" | "is_active">;
  change: StaffChange;
  /** Active super admins, the target included. */
  activeSuperAdmins: number;
}): string | null {
  if (target.id === actorId) return SELF_REFUSAL;
  if (removesActiveSuperAdmin(target, change) && activeSuperAdmins <= 1) return LAST_SUPER_ADMIN_REFUSAL;
  return null;
}
