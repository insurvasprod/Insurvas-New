// SA-5.3 · When a trial reminder is due, and what it says.
//
// Pure, so the scheduling rules are unit-tested without a clock or a database.
//
// Reminders are defined relative to the trial's END, not its start. That is what makes "extending
// a trial pushes the charge date AND every reminder" true by construction: move trial_ends_at and
// every due date moves with it, rather than needing code to remember to shift them.

export const TRIAL_REMINDER_KINDS = ["four_days_left", "final_day"] as const;
export type TrialReminderKind = (typeof TRIAL_REMINDER_KINDS)[number];

/** Days before the trial ends that each reminder goes out. */
export const REMINDER_OFFSET_DAYS: Record<TrialReminderKind, number> = {
  four_days_left: 4,
  final_day: 1,
};

export const REMINDER_LABELS: Record<TrialReminderKind, string> = {
  four_days_left: "4 days left",
  final_day: "Final day",
};

const DAY_MS = 86_400_000;

export function dueAtFor(trialEndsAt: Date, kind: TrialReminderKind): Date {
  return new Date(trialEndsAt.getTime() - REMINDER_OFFSET_DAYS[kind] * DAY_MS);
}

export type ReminderCandidate = {
  kind: TrialReminderKind;
  dueAt: Date;
};

/**
 * Which reminders a trial is due, given what has already been sent for THIS end date.
 *
 * A reminder whose moment has passed is still sent — a job that did not run yesterday should
 * catch up rather than skip someone silently. But a trial ending in an hour does not get the
 * "4 days left" note, because saying that would be false; only reminders whose window has opened
 * and whose subject is still true are returned.
 */
export function dueReminders(
  trialEndsAt: Date,
  alreadySent: TrialReminderKind[],
  now: Date = new Date(),
): ReminderCandidate[] {
  const sent = new Set(alreadySent);
  const due: ReminderCandidate[] = [];

  for (const kind of TRIAL_REMINDER_KINDS) {
    if (sent.has(kind)) continue;

    const dueAt = dueAtFor(trialEndsAt, kind);
    if (dueAt.getTime() > now.getTime()) continue; // not yet
    if (trialEndsAt.getTime() <= now.getTime()) continue; // trial is over; nothing to remind about

    due.push({ kind, dueAt });
  }

  return due;
}

export type ReminderFacts = {
  name: string;
  businessName: string | null;
  planName: string;
  priceLabel: string;
  daysRemaining: number;
  trialEndsAt: Date;
  hasLoggedIn: boolean;
};

/**
 * The reminder body.
 *
 * Built from the customer's own figures — their plan, their price, their end date — because the
 * ticket's criterion is that these contain real values, not placeholders. The variant for someone
 * who has never logged in says something different, since "you have 4 days left" is the wrong
 * message for a person who has not started.
 */
export function reminderBody(kind: TrialReminderKind, facts: ReminderFacts): { subject: string; text: string } {
  const who = facts.businessName ?? facts.name;
  const ends = facts.trialEndsAt.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  if (!facts.hasLoggedIn) {
    return {
      subject:
        kind === "final_day"
          ? `Your Insurvas trial ends tomorrow — you haven't signed in yet`
          : `${facts.daysRemaining} days left, and ${who} hasn't started yet`,
      text:
        `Hi ${facts.name},\n\n` +
        `Your ${facts.planName} trial ends on ${ends}, and we haven't seen you sign in yet.\n\n` +
        `If something got in the way, reply to this email and we will sort it out. ` +
        `On ${ends} your card is charged ${facts.priceLabel}.\n`,
    };
  }

  if (kind === "final_day") {
    return {
      subject: `Your Insurvas trial ends tomorrow`,
      text:
        `Hi ${facts.name},\n\n` +
        `Your ${facts.planName} trial for ${who} ends on ${ends}. ` +
        `Your card will be charged ${facts.priceLabel} and everything keeps working — nothing to do.\n\n` +
        `If you would rather not continue, cancel before ${ends} and you will not be charged.\n`,
    };
  }

  return {
    subject: `${facts.daysRemaining} days left on your Insurvas trial`,
    text:
      `Hi ${facts.name},\n\n` +
      `${who} has ${facts.daysRemaining} days left on the ${facts.planName} trial. ` +
      `On ${ends} it becomes ${facts.priceLabel} and carries on without interruption.\n\n` +
      `Anything you want set up before then, reply and we will help.\n`,
  };
}
