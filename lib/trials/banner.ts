// SA-5.3 · The in-app half of the day-13 reminder.
//
// Shares REMINDER_OFFSET_DAYS with the emails on purpose: the banner turning urgent and the
// final-day email going out are the same moment by definition, so they cannot drift apart.

import { REMINDER_OFFSET_DAYS } from "./reminders.ts";

const DAY_MS = 86_400_000;

/**
 * Whole calendar days between now and the end date.
 *
 * NOT `ceil(millisecondsLeft / a day)`, which was the first attempt: two days and thirty seconds
 * rounds up to "3 days left" while the same message names a date two days away, so the sentence
 * contradicts itself. Counting dates is what a reader means by "days left" and always agrees with
 * the date printed beside it. Found in a browser, on a trial set to end in exactly two days.
 */
export function calendarDaysUntil(end: Date, now: Date): number {
  const midnight = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((midnight(end) - midnight(now)) / DAY_MS);
}

export type TrialBanner = {
  tone: "info" | "urgent";
  message: string;
  daysRemaining: number;
};

/**
 * What the trial banner says, or null when there is nothing to say.
 *
 * Silent until the "4 days left" mark. A banner on day 1 of 14 is noise, and a customer who is
 * shown an urgent notice for two weeks stops reading it — which is exactly when it needs to work.
 */
export function trialBanner(trialEndsAt: Date | null, now: Date = new Date()): TrialBanner | null {
  if (!trialEndsAt) return null;

  if (trialEndsAt.getTime() <= now.getTime()) return null; // over; the status says what happened

  const daysRemaining = calendarDaysUntil(trialEndsAt, now);
  if (daysRemaining > REMINDER_OFFSET_DAYS.four_days_left) return null;

  const ends = trialEndsAt.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  if (daysRemaining <= REMINDER_OFFSET_DAYS.final_day) {
    return {
      tone: "urgent",
      daysRemaining,
      message:
        `Your trial ends ${daysRemaining === 0 ? "today" : "tomorrow"}. Your card will be charged on ` +
        `${ends} and everything keeps working — nothing to do.`,
    };
  }

  return {
    tone: "info",
    daysRemaining,
    message: `${daysRemaining} days left on your trial. On ${ends} it becomes a paid plan and carries on without interruption.`,
  };
}
