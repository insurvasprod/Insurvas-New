/**
 * Wording for the Users & seats tab and its CSV export. Plain module: the client island and the
 * export route both use it, so the file and the screen say the same thing.
 */
import { relativeSeen } from "../tenantTeam/lastSeen.ts";
import { userStatusLabel } from "../users/constants.ts";
import type { AdminTenantMember } from "./types.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "9 Sep". UTC so the server render and the browser agree, and spelled out rather than left to
 * Intl, whose en-GB short month for September is "Sept" in current ICU and "Sep" in older builds.
 */
export function dayMonth(value: string): string {
  const date = new Date(value);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export type StateTone = "success" | "info" | "warning" | "error" | "neutral";

/** The State cell: "Active", "Invited 9 Sep", "Suspended", "Deactivated", "Deleted". */
export function memberState(member: AdminTenantMember): { label: string; tone: StateTone; note: string | null } {
  if (member.seat === "invited") {
    const note = member.stale && member.inviteExpiresAt ? `Invite expired ${dayMonth(member.inviteExpiresAt)}` : null;
    return { label: member.revocable ? `Invited ${dayMonth(member.invitedAt)}` : "Invited", tone: "info", note };
  }
  if (member.seat === "active") return { label: "Active", tone: "success", note: null };
  if (member.seat === "suspended") return { label: "Suspended", tone: "error", note: null };
  if (member.status === "inactive" || member.status === "deactivated") return { label: "Deactivated", tone: "neutral", note: null };
  if (member.status === "deleted") return { label: "Deleted", tone: "neutral", note: null };
  return { label: userStatusLabel(member.status), tone: "neutral", note: null };
}

/** The Last seen cell: "Now", "4 min", "1 hr", "Signed in 3 days", "Never". */
export function lastSeenLabel(member: Pick<AdminTenantMember, "lastSeenAt" | "lastLoginAt">, now: number): string {
  const short = (value: string) => relativeSeen(value, now).replace(/ ago$/, "");
  if (member.lastSeenAt) return short(member.lastSeenAt);
  if (member.lastLoginAt) {
    const label = short(member.lastLoginAt);
    return label === "Now" ? "Signed in just now" : `Signed in ${label}`;
  }
  return "Never";
}

/** Board order: owners, then working members, then invites, then people who hold no seat. */
export function sortMembers(members: readonly AdminTenantMember[]): AdminTenantMember[] {
  const rank = (m: AdminTenantMember) => (m.role === "owner" && m.seat && m.seat !== "invited" ? 0 : m.seat === "active" || m.seat === "suspended" ? 1 : m.seat === "invited" ? 2 : 3);
  return [...members].sort((a, b) => rank(a) - rank(b) || a.invitedAt.localeCompare(b.invitedAt) || a.name.localeCompare(b.name));
}

/** One CSV cell: quoted, and a leading formula character neutralised so a spreadsheet cannot run it. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const CSV_HEADER = ["Name", "Email", "Role", "State", "Holds a seat", "Invited", "Accepted", "Last seen", "Last sign-in", "Sign-ins (30d)", "Invite expires"];

export function membersCsv(members: readonly AdminTenantMember[], roleLabel: (role: string) => string): string {
  const rows = sortMembers(members).map((m) => [
    m.name,
    m.email,
    roleLabel(m.role),
    memberState(m).label,
    m.seat ? "Yes" : "No",
    m.invitedAt,
    m.acceptedAt ?? "",
    m.lastSeenAt ?? "",
    m.lastLoginAt ?? "",
    m.signIns30d ?? "",
    m.inviteExpiresAt ?? "",
  ]);
  return [CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/* ── the seat callout ─────────────────────────────────────────────────────────────────────── */

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const ORDINALS = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth", "twenty-first"];

/** "two", "twelve", 21 → "21". */
export function numberWord(n: number): string {
  return n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
}

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "a thirteenth", "an eleventh", "a 25th". */
function nthPerson(n: number): string {
  if (n >= 0 && n < ORDINALS.length) return `${/^[aeiou]/.test(ORDINALS[n]) ? "an" : "a"} ${ORDINALS[n]}`;
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${String(n).startsWith("8") ? "an" : "a"} ${n}${suffix}`;
}

export type SeatCalloutTone = "info" | "success" | "warning" | "error";

/**
 * The callout above the seat meter. The board's copy ("Every seat is taken, and two of them are
 * invites") is one of these variants; the numbers are always the tenant's.
 */
export function seatCallout(seats: { held: number; invited: number; max: number | null }): { tone: SeatCalloutTone; title: string; body: string } {
  const { held, invited, max } = seats;
  const inviteRule = "An invite holds a seat from the moment it is sent.";
  if (max === null) {
    return {
      tone: "info",
      title: "This plan does not limit seats",
      body: `${inviteRule} ${cap(numberWord(held))} ${held === 1 ? "seat is" : "seats are"} held${invited ? `, ${numberWord(invited)} of them by ${invited === 1 ? "an invite" : "invites"} not accepted yet` : ""}.`,
    };
  }
  if (held > max) {
    const toFree = held - max + 1;
    return {
      tone: "error",
      title: "More seats are held than the plan allows",
      body: `${cap(numberWord(held))} seats are held on a ${max}-seat plan, which usually follows a move to a smaller plan. Nobody new can join until ${numberWord(toFree)} ${toFree === 1 ? "seat is" : "seats are"} freed or the plan changes.`,
    };
  }
  if (held === max && invited > 0) {
    return {
      tone: "warning",
      title: `Every seat is taken, and ${numberWord(invited)} of them ${invited === 1 ? "is an invite" : "are invites"}`,
      body: `${inviteRule} ${cap(numberWord(invited))} of these ${numberWord(max)} ${invited === 1 ? "has" : "have"} never been accepted, which is why the owner cannot invite ${nthPerson(max + 1)} person.`,
    };
  }
  if (held === max) {
    return {
      tone: "warning",
      title: "Every seat is taken",
      body: `All ${numberWord(max)} ${max === 1 ? "seat is" : "seats are"} held by people who can sign in or are suspended, so the owner cannot invite anyone else until a seat is freed or the plan changes.`,
    };
  }
  const free = max - held;
  return {
    tone: "success",
    title: `${cap(numberWord(free))} of ${numberWord(max)} ${max === 1 ? "seat is" : "seats are"} free`,
    body: invited
      ? `${inviteRule} ${cap(numberWord(invited))} of the ${numberWord(held)} held ${invited === 1 ? "is an invite that has" : "are invites that have"} not been accepted yet.`
      : `${inviteRule} The owner can send ${numberWord(free)} more before the plan needs to change.`,
  };
}
