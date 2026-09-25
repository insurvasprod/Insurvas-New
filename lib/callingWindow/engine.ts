// LA-2.4 · May I legally dial this person right now?
//
// One function answers it, and the queue simply does not serve a lead when the answer is no.
//
// Pure: no database, no clock, no network. Every rule that decides whether a call is legal is
// decided here and unit-tested, because the alternative is a compliance rule that only holds when
// a particular caller remembers to check — and $500–$1,500 per violation is the wrong place to
// find out that one caller forgot.
//
// The five layers, and the one property that makes them safe:
//
//   federal          8:00–21:00 in the CUSTOMER's local time
//   state override   several states are tighter; some restrict Sundays and holidays
//   holiday calendar per state
//   tenant           the tenant may narrow it further
//   campaign         an optional narrower window per campaign
//
// The effective window is always the MOST RESTRICTIVE of these, and **widening is not
// expressible**. That is not a convention this module follows; it is the only operation it has.
// `narrow()` takes max(start) and min(end), so handing it a wider window is a no-op rather than a
// privilege escalation. A rule that could be widened by configuration is a rule that will be.

/** A local-time window, half-open: [startHour, endHour). Hours are 0–24 in the customer's zone. */
export type CallingWindow = { startHour: number; endHour: number };

/** 8am to 9pm local, the federal floor. Everything else may only cut into this. */
export const FEDERAL_WINDOW: CallingWindow = { startHour: 8, endHour: 21 };

export type StateRule = {
  /** Two-letter code. */
  state: string;
  /** Tighter than federal, if the statute says so. */
  window?: CallingWindow;
  /** Some states forbid solicitation calls on Sundays. */
  noSunday?: boolean;
  /** And some on state holidays. */
  noHolidays?: boolean;
};

export type DialRefusal =
  | "no_state"
  | "unknown_state"
  | "outside_window"
  | "sunday"
  | "holiday"
  | "window_closed";

export type DialDecision = {
  allowed: boolean;
  reason: "ok" | DialRefusal;
  /** The effective window after every layer, or null when no dialing is possible at all. */
  window: CallingWindow | null;
  timezone: string | null;
  /** The customer's local time, for the screen to explain itself with. */
  localHour: number | null;
  localWeekday: number | null;
  /** A sentence the dialer can show. Never blank when `allowed` is false. */
  message: string | null;
};

/**
 * The only way to combine two windows.
 *
 * max of the starts, min of the ends. A candidate that starts earlier or ends later than the base
 * changes nothing, which is what "widening is not expressible" means in practice — it is a property
 * of the operation rather than a check somebody has to remember to write.
 */
export function narrow(base: CallingWindow, candidate: CallingWindow | undefined | null): CallingWindow {
  if (!candidate) return base;
  return {
    startHour: Math.max(base.startHour, candidate.startHour),
    endHour: Math.min(base.endHour, candidate.endHour),
  };
}

/** A window that has been narrowed out of existence — start at or after end — permits nothing. */
export function isClosed(window: CallingWindow): boolean {
  return window.startHour >= window.endHour;
}

/**
 * The customer's local hour, weekday and calendar date in one pass.
 *
 * `Intl.DateTimeFormat` with a `timeZone` is the resolution: it knows that America/Phoenix does not
 * observe DST and that America/New_York does, and it knows it for the specific instant rather than
 * for "now". Deriving an offset by arithmetic is where the two-pass DST problem comes from, and the
 * fix is to not do the arithmetic.
 *
 * The hour-24 guard is real: some engines render midnight as `24`, which would read as an hour
 * outside every window rather than the start of the day.
 */
export function localPartsIn(at: Date, timezone: string): { hour: number; weekday: number; isoDate: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekday = weekdays.indexOf(parts.weekday);

  return {
    hour,
    weekday,
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export type CanDialInput = {
  /** Two-letter state code from the lead. Null or unknown means not dialable — never a default. */
  state: string | null;
  at: Date;
  /** state code -> IANA zone. */
  timezones: Record<string, string>;
  /** state code -> statutory tightening. */
  stateRules?: Record<string, StateRule>;
  /** `${state}:${YYYY-MM-DD}` entries, or `*:${YYYY-MM-DD}` for federal holidays. */
  holidays?: ReadonlySet<string>;
  /** The tenant's own tightening. May only narrow. */
  tenantWindow?: CallingWindow | null;
  /** A campaign's tightening. May only narrow. */
  campaignWindow?: CallingWindow | null;
};

/**
 * May I dial this person right now?
 *
 * A lead with no state has no timezone and is NOT dialable. That is the criterion, and it is the
 * opposite of what `customerTimezone` does for callbacks, which falls back to America/New_York.
 * That fallback is defensible for rendering a reminder and indefensible here: assuming Eastern for
 * someone in California means dialing them at 5am, which is the violation this module exists to
 * prevent. Absence of data is not permission.
 */
export function canDialNow(input: CanDialInput): DialDecision {
  const blocked = (reason: DialRefusal, message: string, extra: Partial<DialDecision> = {}): DialDecision => ({
    allowed: false,
    reason,
    window: null,
    timezone: null,
    localHour: null,
    localWeekday: null,
    message,
    ...extra,
  });

  const state = input.state?.trim().toUpperCase() || null;
  if (!state) {
    return blocked("no_state", "This lead has no state, so there is no way to know its local time. It cannot be dialled.");
  }

  const timezone = input.timezones[state];
  if (!timezone) {
    return blocked("unknown_state", `No timezone is known for ${state}, so this lead cannot be dialled.`);
  }

  const { hour, weekday, isoDate } = localPartsIn(input.at, timezone);
  const rule = input.stateRules?.[state];

  // Federal first, then each tightening. Order does not matter — narrow() is commutative — but it
  // reads in the order the statute stack does.
  let window = narrow(FEDERAL_WINDOW, rule?.window);
  window = narrow(window, input.tenantWindow);
  window = narrow(window, input.campaignWindow);

  const common = { window, timezone, localHour: hour, localWeekday: weekday };

  if (isClosed(window)) {
    return {
      ...blocked("window_closed", "The configured calling window leaves no time when this lead may be dialled."),
      ...common,
    };
  }

  if (rule?.noSunday && weekday === 0) {
    return {
      ...blocked("sunday", `${state} does not permit these calls on a Sunday.`),
      ...common,
    };
  }

  if (rule?.noHolidays && (input.holidays?.has(`${state}:${isoDate}`) || input.holidays?.has(`*:${isoDate}`))) {
    return {
      ...blocked("holiday", `${isoDate} is a holiday in ${state}, which does not permit these calls.`),
      ...common,
    };
  }

  if (hour < window.startHour || hour >= window.endHour) {
    return {
      ...blocked(
        "outside_window",
        `It is ${String(hour).padStart(2, "0")}:00 for this lead. Calls are permitted between ${String(window.startHour).padStart(2, "0")}:00 and ${String(window.endHour).padStart(2, "0")}:00 local time.`,
      ),
      ...common,
    };
  }

  return { allowed: true, reason: "ok", message: null, ...common };
}

export type StateRuleInForce = {
  state: string;
  startHour: number;
  endHour: number;
  noSunday: boolean;
  noHolidays: boolean;
};

export type CallingWindowSettings = {
  federal: CallingWindow;
  /** The tenant's own narrowing, or null when they have never set one. Minutes win when present. */
  tenant: (CallingWindow & { startMinute?: number | null; endMinute?: number | null }) | null;
  /** Campaigns that narrow further still. Both ends null means the campaign adds nothing. */
  campaigns: CampaignWindow[];
  /** State statutes currently in force, read-only — these are the platform's to maintain. */
  stateRules: StateRuleInForce[];
  /** False when the rules function is not present on this deployment. */
  stateRulesAvailable: boolean;
  /** The agency's three switches (20260924121000); defaults until that is applied. */
  options: CallingWindowOptions;
  /** False until 20260924121000 is applied: minutes, switches and reasons cannot be saved yet. */
  schemaReady: boolean;
  /** Upcoming dates in the federal holiday calendar, or null when it could not be read. */
  federalHolidays: { date: string; name: string }[] | null;
  /**
   * When the state rules were last refreshed (20260924230100), or null before that is applied.
   * `stale` is the dial check's own answer: when true, `tenant_can_dial_now` refuses every dial.
   */
  rulesFeed?: RulesFeed | null;
  /**
   * The states this agency works in — its live leads' states and its members' licensed states —
   * or null when neither could be read. The board lists these, federal-hours states included.
   */
  dialingStates?: string[] | null;
};

export type RulesFeed = { lastRefreshedAt: string; source: string; staleAfterDays: number; stale: boolean };

/**
 * Which state rows the screen lists: every state the agency works in, whether or not its law is
 * tighter than federal; failing that (nothing known yet), only the states whose rule bites.
 */
export function statesToList(
  rules: StateRuleInForce[],
  dialingStates: string[] | null | undefined,
  bites: (rule: StateRuleInForce) => boolean,
): { rules: StateRuleInForce[]; basis: "worked" | "notable" } {
  const worked = new Set((dialingStates ?? []).map((state) => state.toUpperCase()));
  if (worked.size > 0) {
    const byState = new Map(rules.map((rule) => [rule.state, rule]));
    const listed = [...worked]
      .map((state) => byState.get(state) ?? { state, startHour: FEDERAL_WINDOW.startHour, endHour: FEDERAL_WINDOW.endHour, noSunday: false, noHolidays: false })
      .sort((a, b) => a.state.localeCompare(b.state));
    return { rules: listed, basis: "worked" };
  }
  return { rules: rules.filter(bites), basis: "notable" };
}

/**
 * What the tenant's setting actually achieves, given everything above it.
 *
 * Narrowing is `max(start)`, `min(end)`, so asking for 07:00 in a state that starts at 09:00 buys
 * nothing at all. The screen shows this per state rather than describing the rule, because the
 * useful answer to "when can we call Illinois" is a pair of hours, not an algorithm.
 */
export function effectiveWindow(
  federal: CallingWindow,
  stateRule: StateRuleInForce | undefined,
  tenant: CallingWindow | null,
  campaign: CallingWindow | null,
): CallingWindow {
  let start = federal.startHour;
  let end = federal.endHour;
  if (stateRule) {
    start = Math.max(start, stateRule.startHour);
    end = Math.min(end, stateRule.endHour);
  }
  if (tenant) {
    start = Math.max(start, tenant.startHour);
    end = Math.min(end, tenant.endHour);
  }
  if (campaign) {
    start = Math.max(start, campaign.startHour);
    end = Math.min(end, campaign.endHour);
  }
  return { startHour: start, endHour: end };
}

// ── minute precision, the agency's switches, and a reason per campaign ─────────────────────────
//
// 20260924121000 lets the tenant and campaign windows carry minutes ("7:30 pm") and adds three
// agency switches. `tenant_can_dial_now` is the enforcement; these helpers are how the screen
// computes the same answer, with the same only-narrows operation, in minutes of the customer's day.

/** A window in minutes of the customer's local day, half-open: [start, end). */
export type MinuteWindow = { start: number; end: number };

export const FEDERAL_MINUTES: MinuteWindow = { start: FEDERAL_WINDOW.startHour * 60, end: FEDERAL_WINDOW.endHour * 60 };

/** A stored window with its optional minute columns. Minutes win when present. */
export type StoredWindow = { startHour: number; endHour: number; startMinute?: number | null; endMinute?: number | null };

export function toMinutes(window: StoredWindow): MinuteWindow {
  return {
    start: window.startMinute ?? window.startHour * 60,
    end: window.endMinute ?? window.endHour * 60,
  };
}

/**
 * The hour columns written beside the minutes. Rounded INWARD (start up, end down), so a reader
 * that only knows hours sees a window no wider than the real one; outward only when inward would
 * leave nothing (a window inside a single hour), because the column pair must stay start < end.
 */
export function hoursFor(window: MinuteWindow): CallingWindow {
  const inward = { startHour: Math.ceil(window.start / 60), endHour: Math.floor(window.end / 60) };
  if (inward.startHour < inward.endHour) return inward;
  return { startHour: Math.floor(window.start / 60), endHour: Math.ceil(window.end / 60) };
}

export type CallingWindowOptions = {
  /** Nothing dials on a Sunday in the customer's zone, in any state. */
  noSunday: boolean;
  /** Nothing dials on a date in the platform's federal holiday calendar. */
  noFederalHolidays: boolean;
  /** Off = every campaign's narrowing is ignored. */
  campaignOverrides: boolean;
};

export const DEFAULT_OPTIONS: CallingWindowOptions = { noSunday: false, noFederalHolidays: false, campaignOverrides: true };

export type CampaignWindow = {
  id: string;
  name: string;
  startHour: number | null;
  endHour: number | null;
  startMinute: number | null;
  endMinute: number | null;
  reason: string | null;
};

/** A campaign's narrowing in minutes, or null when it adds nothing. */
export function campaignMinutes(campaign: CampaignWindow): { start: number | null; end: number | null } | null {
  const start = campaign.startMinute ?? (campaign.startHour == null ? null : campaign.startHour * 60);
  const end = campaign.endMinute ?? (campaign.endHour == null ? null : campaign.endHour * 60);
  return start == null && end == null ? null : { start, end };
}

/** Every layer, narrowed, in minutes. Same operation as `effectiveWindow`, same order as the SQL. */
export function effectiveMinutes(
  stateRule: StateRuleInForce | undefined,
  tenant: MinuteWindow | null,
  campaign: { start: number | null; end: number | null } | null,
): MinuteWindow {
  let { start, end } = FEDERAL_MINUTES;
  if (stateRule) {
    start = Math.max(start, stateRule.startHour * 60);
    end = Math.min(end, stateRule.endHour * 60);
  }
  if (tenant) {
    start = Math.max(start, tenant.start);
    end = Math.min(end, tenant.end);
  }
  if (campaign?.start != null) start = Math.max(start, campaign.start);
  if (campaign?.end != null) end = Math.min(end, campaign.end);
  return { start, end };
}

/** 1170 → `7:30 pm`; `short` drops the half of the day, for the board's "9:00 – 7:30" pills. */
export function minuteLabel(minutes: number, short = false): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(m / 60);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const text = `${h12}:${String(m % 60).padStart(2, "0")}`;
  return short ? text : `${text} ${hour < 12 ? "am" : "pm"}`;
}

/** `19:30` ↔ 1170, for `<input type="time">`. */
export function minuteToInput(minutes: number | null | undefined): string {
  if (minutes == null) return "";
  const m = Math.min(1439, Math.max(0, minutes));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function inputToMinute(value: string, isEnd = false): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  // An end of 00:00 means midnight at the close of the day, not the start of it.
  return isEnd && minutes === 0 ? 1440 : minutes;
}
