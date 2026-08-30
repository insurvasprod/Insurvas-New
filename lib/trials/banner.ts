// SA-5.3 · The in-app half of the day-13 reminder.
//
// Shares REMINDER_OFFSET_DAYS with the emails on purpose: the banner turning urgent and the
// final-day email going out are the same moment by definition, so they cannot drift apart.

import { REMINDER_OFFSET_DAYS } from "./reminders.ts";

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

  const msLeft = trialEndsAt.getTime() - now.getTime();
  if (msLeft <= 0) return null; // over; the subscription's own status says what happened

  // Ceiling, not floor: with 30 hours left a customer has "2 days", and rounding down to 1 would
  // tell them the charge lands sooner than it does.
  const daysRemaining = Math.ceil(msLeft / 86_400_000);
  if (daysRemaining > REMINDER_OFFSET_DAYS.four_days_left) return null;

  const ends = trialEndsAt.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  if (daysRemaining <= REMINDER_OFFSET_DAYS.final_day) {
    return {
      tone: "urgent",
      daysRemaining,
      message: `Your trial ends tomorrow. Your card will be charged on ${ends} and everything keeps working — nothing to do.`,
    };
  }

  return {
    tone: "info",
    daysRemaining,
    message: `${daysRemaining} days left on your trial. On ${ends} it becomes a paid plan and carries on without interruption.`,
  };
}
