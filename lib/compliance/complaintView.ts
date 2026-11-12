import { CATEGORY_LABELS, CHANNEL_LABELS, STATUS_LABELS, type ComplaintCategory, type ComplaintChannel, type Countdown, type CountdownTone } from "./complaints";

/**
 * What the Complaints list and a complaint's page both draw (foundation pass 2026-11-03; round 7 2026-11-11,
 * mockups-r7/compliance.html 4·A). A plain module, because a server page cannot call a "use client" export.
 */
export type ComplaintChipTone = "danger" | "warning" | "good" | "neutral";

/** The countdown chip: overdue and red are danger, amber and a missing deadline need action. */
export const COMPLAINT_TONE: Record<CountdownTone, ComplaintChipTone> = { overdue: "danger", red: "danger", amber: "warning", no_deadline: "warning", calm: "neutral", none: "neutral" };

/** "Unwanted calls complaint": the record's title when nobody is named. */
export const complaintTitle = (c: { category: string }) => `${CATEGORY_LABELS[c.category as ComplaintCategory] ?? c.category} complaint`;

/** The record's title and the list's first cell: the complainant, else what it is about. */
export const complaintName = (c: { complainantName: string | null; category: string }) => c.complainantName?.trim() || complaintTitle(c);

/** Who it was made to, short: "FL DOI", "FTC", "To the agent". */
export const complaintChannel = (c: { channel: string; regulatorState: string | null }) =>
  c.channel === "ftc" ? "FTC" : c.channel === "doi" ? `${c.regulatorState ?? "State"} DOI` : CHANNEL_LABELS[c.channel as ComplaintChannel] ?? c.channel;

/** The status word's tone when there is no clock to show: done is good, escalated is wrong, waiting on the regulator waits. */
const STATUS_TONE: Record<string, ComplaintChipTone> = { resolved: "good", escalated: "danger", awaiting_regulator: "warning" };

/**
 * The one chip a complaint row carries (r7 4·A). A complaint with a deadline says its countdown ("Overdue 9 days"
 * danger; "6 days left" warning inside the amber threshold, danger inside the red one, from Compliance settings);
 * a regulator complaint with no deadline says "Set the deadline"; anything else says its status word.
 */
export function complaintChip(c: { status: string; countdown: Countdown }): { tone: ComplaintChipTone; label: string } {
  const { tone, daysLeft } = c.countdown;
  const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  if (tone === "overdue") return { tone: "danger", label: `Overdue ${days(Math.abs(daysLeft ?? 1))}` };
  if ((tone === "red" || tone === "amber" || tone === "calm") && daysLeft !== null) return { tone: COMPLAINT_TONE[tone], label: `${days(Math.max(1, daysLeft))} left` };
  if (tone === "no_deadline") return { tone: "warning", label: "Set the deadline" };
  return { tone: STATUS_TONE[c.status] ?? "neutral", label: STATUS_LABELS[c.status as keyof typeof STATUS_LABELS] ?? c.status };
}

/**
 * The list a complaint's ‹ › walks: Not resolved in the list's own order (soonest deadline first), or All when
 * the complaint is resolved and so not in it. `rows` comes from listComplaints, already sorted.
 */
export function complaintWalk<T extends { id: string; status: string }>(rows: readonly T[], id: string): readonly T[] {
  const open = rows.filter((c) => c.status !== "resolved");
  return open.some((c) => c.id === id) ? open : rows;
}
