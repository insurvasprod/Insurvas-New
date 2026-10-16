/**
 * LA-6.4 (Notion sprint, Module 6 — Compliance) · complaint rules: the labels, the countdown and the
 * order. Pure, so the rules are tested without a database.
 *
 * The countdown is the feature. A DOI complaint carries a statutory response deadline; days
 * remaining is the primary sort, amber at 10 days, red at 5, and an overdue one is the loudest thing
 * in the product. Everything else in LA-6 can wait a week. This cannot.
 */

export const COMPLAINT_CHANNELS = ["agent", "carrier", "doi", "ftc", "other"] as const;
export type ComplaintChannel = (typeof COMPLAINT_CHANNELS)[number];
export const CHANNEL_LABELS: Record<ComplaintChannel, string> = {
  agent: "To the agent",
  carrier: "Through the carrier",
  doi: "State insurance department (DOI)",
  ftc: "FTC",
  other: "Other",
};
/** Only a regulator's complaint carries a statutory deadline. */
export const DEADLINE_CHANNELS: readonly ComplaintChannel[] = ["doi", "ftc"];

export const COMPLAINT_VIA = ["phone", "email", "letter", "portal", "carrier_notice"] as const;
export const VIA_LABELS: Record<(typeof COMPLAINT_VIA)[number], string> = { phone: "Phone", email: "Email", letter: "Letter", portal: "Portal", carrier_notice: "Carrier notice" };

export const COMPLAINT_CATEGORIES = ["unwanted_calls", "misrepresentation", "billing", "service", "claim_handling", "agent_conduct", "other"] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  unwanted_calls: "Unwanted calls",
  misrepresentation: "Misrepresentation",
  billing: "Billing",
  service: "Service",
  claim_handling: "Claim handling",
  agent_conduct: "Agent conduct",
  other: "Other",
};

export const COMPLAINT_STATUSES = ["open", "investigating", "responded", "awaiting_regulator", "resolved", "escalated"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
export const STATUS_LABELS: Record<ComplaintStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  responded: "Responded",
  awaiting_regulator: "Awaiting regulator",
  resolved: "Resolved",
  escalated: "Escalated",
};

export const COMPLAINT_OUTCOMES = ["no_action", "agent_corrected", "restitution", "fine", "licence_action"] as const;
export const OUTCOME_LABELS: Record<(typeof COMPLAINT_OUTCOMES)[number], string> = {
  no_action: "No action",
  agent_corrected: "Agent corrected",
  restitution: "Restitution",
  fine: "Fine",
  licence_action: "Licence action",
};

export type Thresholds = { amberDays: number; redDays: number };
export const DEFAULT_THRESHOLDS: Thresholds = { amberDays: 10, redDays: 5 };

export type CountdownTone = "overdue" | "red" | "amber" | "calm" | "no_deadline" | "none";

export type Countdown = {
  tone: CountdownTone;
  /** Whole days left (negative when overdue); null when there is no deadline. */
  daysLeft: number | null;
  label: string;
  /** Inside the red window or overdue: pinned to the top of the compliance dashboard (LA-6.7). */
  pinned: boolean;
};

const DAY_MS = 86_400_000;

/** The countdown for one complaint. A responded or resolved complaint has nothing left to count. */
export function countdown(c: { channel: string; status: string; responseDueAt: string | null; respondedAt: string | null }, now: Date, t: Thresholds = DEFAULT_THRESHOLDS): Countdown {
  const needsDeadline = (DEADLINE_CHANNELS as readonly string[]).includes(c.channel);
  const answered = c.respondedAt !== null || c.status === "responded" || c.status === "resolved" || c.status === "awaiting_regulator";
  if (!c.responseDueAt) {
    if (needsDeadline && !answered) return { tone: "no_deadline", daysLeft: null, label: "No deadline set — set the regulator's response days", pinned: false };
    return { tone: "none", daysLeft: null, label: answered ? "Answered" : "No statutory deadline", pinned: false };
  }
  if (answered) return { tone: "none", daysLeft: null, label: "Answered", pinned: false };
  const ms = Date.parse(c.responseDueAt) - now.getTime();
  const daysLeft = Math.ceil(ms / DAY_MS);
  if (ms < 0) {
    const late = Math.max(1, Math.floor(-ms / DAY_MS));
    return { tone: "overdue", daysLeft: -late, label: `Overdue by ${late} day${late === 1 ? "" : "s"}`, pinned: true };
  }
  const label = daysLeft <= 1 ? "Respond within 1 day" : `Respond within ${daysLeft} days`;
  if (daysLeft <= t.redDays) return { tone: "red", daysLeft, label, pinned: true };
  if (daysLeft <= t.amberDays) return { tone: "amber", daysLeft, label, pinned: false };
  return { tone: "calm", daysLeft, label, pinned: false };
}

const TONE_RANK: Record<CountdownTone, number> = { overdue: 0, red: 1, no_deadline: 2, amber: 3, calm: 4, none: 5 };

/** Days remaining is the primary sort, ascending; a regulator complaint missing its deadline sits just under the red ones. */
export function sortComplaints<T extends { countdown: Countdown; receivedAt: string; status: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const resolvedA = a.status === "resolved" ? 1 : 0;
    const resolvedB = b.status === "resolved" ? 1 : 0;
    if (resolvedA !== resolvedB) return resolvedA - resolvedB;
    const r = TONE_RANK[a.countdown.tone] - TONE_RANK[b.countdown.tone];
    if (r) return r;
    if (a.countdown.daysLeft !== null && b.countdown.daysLeft !== null && a.countdown.daysLeft !== b.countdown.daysLeft) return a.countdown.daysLeft - b.countdown.daysLeft;
    return b.receivedAt.localeCompare(a.receivedAt);
  });
}

/** "Deadlines configured for 3 of 14 licensed states. Complaints from the other 11 will have no countdown." */
export function deadlineCoverage(licensedStates: string[], configured: string[]) {
  const licensed = [...new Set(licensedStates.map((s) => s.toUpperCase()))].sort();
  const set = new Set(configured.map((s) => s.toUpperCase()));
  const missing = licensed.filter((s) => !set.has(s));
  const covered = licensed.length - missing.length;
  const sentence = licensed.length
    ? `Deadlines configured for ${covered} of ${licensed.length} licensed state${licensed.length === 1 ? "" : "s"}.${missing.length ? ` Complaints from the other ${missing.length} will have no countdown.` : ""}`
    : "No licensed states on file, so no state's deadline can be checked.";
  return { licensed: licensed.length, covered, missing, ftc: set.has("FTC"), sentence };
}
