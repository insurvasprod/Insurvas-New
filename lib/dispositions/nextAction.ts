/**
 * An outcome's next action: what the dialer does after it is recorded (migration 20260924240200,
 * `complete_existing_dial_disposition`). Plain module, no aliases: the settings screen, the service
 * and a `node --test` file share it.
 *
 *   cadence   the tenant's retry cadence                       ends dialing: no
 *   retry     back in the queue after N minutes (ceiling kept)  ends dialing: no
 *   rest      off the dialer for N minutes, then served again   ends dialing: yes
 *   close     closed, no further attempts                       ends dialing: yes
 *   callback  callback_scheduled only: a time is booked         ends dialing: yes
 *   suppress  do_not_call only: added to the do-not-call list   ends dialing: yes
 */

export const NEXT_ACTION_KINDS = ["cadence", "retry", "rest", "close", "callback", "suppress"] as const;
export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];

export const DO_NOT_CALL_KEY = "do_not_call";
export const CALLBACK_KEY = "callback_scheduled";

/** The longest retry delay or rest the database accepts: a year, in minutes. */
export const NEXT_ACTION_MAX_MINUTES = 525_600;

export type NextActionSetting = { kind: NextActionKind; minutes: number | null };

/** The kinds a given outcome may choose from. The two compliance outcomes have exactly one. */
export function allowedNextActions(dispositionKey: string): NextActionKind[] {
  if (dispositionKey === DO_NOT_CALL_KEY) return ["suppress"];
  if (dispositionKey === CALLBACK_KEY) return ["callback"];
  return ["cadence", "retry", "rest", "close"];
}

/** Whether an outcome with this next action ends dialing — the `ends_call` column, kept in step. */
export function endsDialing(kind: NextActionKind): boolean {
  return kind === "close" || kind === "rest" || kind === "callback" || kind === "suppress";
}

export function needsMinutes(kind: NextActionKind): boolean {
  return kind === "retry" || kind === "rest";
}

/** What the dialer does today for a row with no next action stored (before 20260924240200). */
export function derivedNextAction(dispositionKey: string, endsCall: boolean | null | undefined): NextActionSetting | null {
  if (dispositionKey === DO_NOT_CALL_KEY) return { kind: "suppress", minutes: null };
  if (dispositionKey === CALLBACK_KEY) return { kind: "callback", minutes: null };
  if (endsCall == null) return null;
  return { kind: endsCall ? "close" : "cadence", minutes: null };
}

/** Throws a sentence a person can act on; returns the setting to store. */
export function validateNextAction(dispositionKey: string, kind: unknown, minutes: unknown): NextActionSetting {
  if (typeof kind !== "string" || !(NEXT_ACTION_KINDS as readonly string[]).includes(kind)) {
    throw new Error("Choose what happens after this outcome.");
  }
  const chosen = kind as NextActionKind;
  if (!allowedNextActions(dispositionKey).includes(chosen)) {
    throw new Error(
      dispositionKey === DO_NOT_CALL_KEY
        ? "Do not call always adds the number to your do-not-call list."
        : dispositionKey === CALLBACK_KEY
          ? "A callback always books a time."
          : "Only Do not call suppresses the number, and only a callback books a time.",
    );
  }
  if (!needsMinutes(chosen)) return { kind: chosen, minutes: null };
  const value = typeof minutes === "number" ? minutes : Number(minutes);
  if (!Number.isInteger(value) || value < 1 || value > NEXT_ACTION_MAX_MINUTES) {
    throw new Error(chosen === "retry" ? "Choose a retry delay between 1 minute and 365 days." : "Choose a rest between 1 minute and 365 days.");
  }
  return { kind: chosen, minutes: value };
}

export type DurationUnit = "minutes" | "hours" | "days";

/** The largest unit a duration is a whole number of, for the editor's number + unit pair. */
export function splitMinutes(minutes: number): { value: number; unit: DurationUnit } {
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: "days" };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}

export function toMinutes(value: number, unit: DurationUnit): number {
  return Math.round(value * (unit === "days" ? 1440 : unit === "hours" ? 60 : 1));
}

function duration(minutes: number): string {
  const { value, unit } = splitMinutes(minutes);
  const singular = unit.slice(0, -1);
  return `${value} ${value === 1 ? singular : unit}`;
}

/** The table's phrase: "Next cadence attempt", "Retry in 20 minutes", "Rest 90 days", … */
export function nextActionLabel(setting: NextActionSetting | null): string {
  if (!setting) return "—";
  switch (setting.kind) {
    case "cadence":
      return "Next cadence attempt";
    case "retry":
      return setting.minutes ? `Retry in ${duration(setting.minutes)}` : "Retry";
    case "rest":
      return setting.minutes ? `Rest ${duration(setting.minutes)}` : "Rest";
    case "close":
      return "Close — no further attempts";
    case "callback":
      return "Book a time · required";
    case "suppress":
      return "Add to the do-not-call list";
  }
}

export const NEXT_ACTION_OPTION_LABELS: Record<NextActionKind, string> = {
  cadence: "Next cadence attempt",
  retry: "Retry after a set time",
  rest: "Rest, then call again",
  close: "Close — no further attempts",
  callback: "Book a callback time",
  suppress: "Add to the do-not-call list",
};
