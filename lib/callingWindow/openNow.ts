import { FEDERAL_MINUTES, minuteLabel, stateRuleMinutes, toMinutes, type CallingWindowSettings, type MinuteWindow } from "./engine.ts";
import { STATE_TIMEZONES } from "../callbacks/timezone.ts";

/**
 * "Calling window open in 31 states · closes 9:00 pm ET" — the phone Home's ready card (mobile board B1).
 *
 * A summary for reading, never a permission: `tenant_can_dial_now` still decides every dial. It applies the
 * same only-narrows layers the screen can see (federal, the state's statute and Sunday hours, the agency's
 * window and switches, the federal holiday calendar) to every state the agency works in, at one instant.
 * Campaign windows are left out: they narrow one campaign, not the agency's day. State-only holidays are not
 * in the settings read, so a state closed for its own holiday can be counted open here (the dial still refuses).
 */
export type OpenNow = {
  /** States the window is open in right now. */
  openStates: number;
  /** States considered: the agency's worked states, else every state with a known zone. */
  states: number;
  /** When the last open state closes, in Eastern time ("9:00 pm ET"); null when none is open. */
  closesAt: string | null;
  /** When the first state opens next today, in Eastern time; null when one is open or none opens again today. */
  opensAt: string | null;
};

const EASTERN = "America/New_York";

function localMinute(at: Date, timezone: string): { minute: number; weekday: number; isoDate: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour12: false, hour: "2-digit", minute: "2-digit", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const hour = Number(parts.hour) % 24;
  return {
    minute: hour * 60 + Number(parts.minute),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

const eastern = (at: Date) => `${minuteLabel(localMinute(at, EASTERN).minute)} ET`;

/** `week`: the agency's week grid (Sunday first), when it has one; a null day is a day off. */
export function openNow(
  settings: Pick<CallingWindowSettings, "stateRules" | "tenant" | "options" | "federalHolidays" | "dialingStates">,
  at: Date,
  week?: Array<MinuteWindow | null> | null,
): OpenNow {
  const worked = (settings.dialingStates ?? []).filter((state) => STATE_TIMEZONES[state]);
  const states = worked.length ? worked : Object.keys(STATE_TIMEZONES);
  const rules = new Map(settings.stateRules.map((rule) => [rule.state, rule]));
  const tenant = settings.tenant ? toMinutes(settings.tenant) : null;
  const holidays = new Set((settings.federalHolidays ?? []).map((h) => h.date));
  let open = 0;
  let lastClose: number | null = null;
  let firstOpen: number | null = null;
  for (const state of states) {
    const { minute, weekday, isoDate } = localMinute(at, STATE_TIMEZONES[state]);
    const rule = rules.get(state);
    if (weekday === 0 && (settings.options.noSunday || rule?.noSunday)) continue;
    if (holidays.has(isoDate) && (settings.options.noFederalHolidays || rule?.noHolidays)) continue;
    const own: MinuteWindow = rule ? stateRuleMinutes(rule, weekday) : FEDERAL_MINUTES;
    const agency = week ? week[weekday] : tenant;
    if (week && !agency) continue;
    const start = Math.max(FEDERAL_MINUTES.start, own.start, agency?.start ?? 0);
    const end = Math.min(FEDERAL_MINUTES.end, own.end, agency?.end ?? 1440);
    if (start >= end) continue;
    if (minute >= start && minute < end) {
      open += 1;
      const close = at.getTime() + (end - minute) * 60_000;
      lastClose = lastClose === null ? close : Math.max(lastClose, close);
    } else if (minute < start) {
      const opens = at.getTime() + (start - minute) * 60_000;
      firstOpen = firstOpen === null ? opens : Math.min(firstOpen, opens);
    }
  }
  return {
    openStates: open,
    states: states.length,
    closesAt: lastClose === null ? null : eastern(new Date(lastClose)),
    opensAt: open === 0 && firstOpen !== null ? eastern(new Date(firstOpen)) : null,
  };
}
