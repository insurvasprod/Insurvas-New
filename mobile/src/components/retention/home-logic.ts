import { dayMonth, localDay, monthLong, urgencyOf } from "./logic";
import type { CaseItem } from "./types";

/**
 * Board B7's own rules (Home · retention), kept beside the screen so the shared retention logic stays untouched.
 * Every figure is the server's: GET /api/app/retention/cases answers the month's counts, the agency's month
 * (`team`) and when the last carrier policy file arrived (`lastFileAt`).
 */

export type MonthCounts = { saved: number; lost: number };

/**
 * The ring card: "23 saved of 41 worked" over "November · team average 48%". Worked is the cases decided this month
 * (saved + lost, the scorecard's rule), so the ring's percentage is the save rate. Nothing decided: no percentage.
 */
export function ringCard(month: MonthCounts, today: string, team: MonthCounts | null | undefined): { pct: number; label: string; title: string; line: string } {
  const worked = month.saved + month.lost;
  const pct = worked ? (month.saved / worked) * 100 : 0;
  const teamWorked = team ? team.saved + team.lost : 0;
  const teamPct = team && teamWorked ? Math.round((team.saved / teamWorked) * 100) : null;
  return {
    pct,
    label: worked ? `${Math.round(pct)}%` : "–",
    title: worked ? `${month.saved} saved of ${worked} worked` : "No cases worked yet",
    line: teamPct === null ? monthLong(today) : `${monthLong(today)} · team average ${teamPct}%`,
  };
}

/** "6:02 am": the phone's own clock, lower-case, no leading zero on the hour. */
export function clockTime(d: Date): string {
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/**
 * The header's subtitle: the time the last carrier file arrived when that was today ("Last carrier file 6:02 am"),
 * else its day ("Last carrier file 19 Nov"). Falls back to the newest file date on a case when the arrival is unknown.
 */
export function lastFileSub(lastFileAt: string | null | undefined, lastFileDate: string | null | undefined, now: Date): string | undefined {
  if (lastFileAt) {
    const at = new Date(lastFileAt);
    if (!Number.isNaN(at.getTime())) {
      const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
      return `Last carrier file ${sameDay ? clockTime(at) : dayMonth(localDay(at))}`;
    }
  }
  return lastFileDate ? `Last carrier file ${dayMonth(lastFileDate)}` : undefined;
}

/** The "Call today" rows: cases past the carrier's date or lost within the week, most urgent first (callToday's order). */
export function callTodayRows(due: readonly CaseItem[], max = 5): CaseItem[] {
  return due.filter((c) => { const u = urgencyOf(c); return u === "over" || u === "week"; }).slice(0, max);
}

/** A row's countdown chip, warn as drawn: "2 days left", "Due today", "3 days over". */
export function countdown(c: Pick<CaseItem, "daysLeft">): string | null {
  if (c.daysLeft === null) return null;
  const n = Math.abs(c.daysLeft);
  const days = `${n} ${n === 1 ? "day" : "days"}`;
  if (c.daysLeft < 0) return `${days} over`;
  return c.daysLeft === 0 ? "Due today" : `${days} left`;
}
