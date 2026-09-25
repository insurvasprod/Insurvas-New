/**
 * The calling window a callback is booked against, as the Callbacks page shows it:
 * "Inside the Arizona calling window · 8am–9pm federal, 8am–8pm AZ" (p-app-callbacks).
 *
 * The page uses these facts to answer while the agent picks a time. They are the published layers
 * (federal, the state, the agency); the server's `tenant_can_dial_now` stays the authority and also
 * weighs holidays, Sundays and the campaign, so a time this calls inside can still be refused — and
 * the refusal says why. Pure, so it is tested without the rules feed.
 */
export type HourWindow = { start: number; end: number };

export type CallbackWindowFacts = {
  state: string;
  federal: HourWindow;
  /** The state's own window, when it narrows the federal one. */
  stateWindow: HourWindow | null;
  /** The agency's window (Settings › Calling windows), when it narrows further. */
  agencyWindow: HourWindow | null;
  effective: HourWindow;
  noSunday: boolean;
};

type Rule = { state: string; startHour: number; endHour: number; noSunday: boolean };

export function callbackWindowFacts(
  state: string,
  federal: { startHour: number; endHour: number },
  stateRules: readonly Rule[],
  agency: { startHour: number; endHour: number } | null,
): CallbackWindowFacts {
  const rule = stateRules.find((entry) => entry.state === state) ?? null;
  const fed = { start: federal.startHour, end: federal.endHour };
  const narrowsFederal = rule && (rule.startHour > fed.start || rule.endHour < fed.end);
  const stateWindow = narrowsFederal ? { start: Math.max(fed.start, rule.startHour), end: Math.min(fed.end, rule.endHour) } : null;
  const base = stateWindow ?? fed;
  const narrowsState = agency && (agency.startHour > base.start || agency.endHour < base.end);
  const agencyWindow = narrowsState ? { start: Math.max(base.start, agency.startHour), end: Math.min(base.end, agency.endHour) } : null;
  return { state, federal: fed, stateWindow, agencyWindow, effective: agencyWindow ?? base, noSunday: Boolean(rule?.noSunday) };
}

/** "8am", "9pm", "12pm". */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/** "8am–9pm federal, 8am–8pm AZ" (and ", 9am–6pm your agency" when the agency narrows it). */
export function windowSummary(facts: CallbackWindowFacts): string {
  const range = (window: HourWindow) => `${hourLabel(window.start)}–${hourLabel(window.end)}`;
  const parts = [`${range(facts.federal)} federal`];
  if (facts.stateWindow) parts.push(`${range(facts.stateWindow)} ${facts.state}`);
  if (facts.agencyWindow) parts.push(`${range(facts.agencyWindow)} your agency`);
  return parts.join(", ");
}

/** Whether a customer-local hour and minute sit inside the effective window. The end is exclusive. */
export function insideWindow(facts: CallbackWindowFacts, hour: number, minute: number): boolean {
  const at = hour * 60 + minute;
  return at >= facts.effective.start * 60 && at < facts.effective.end * 60;
}

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
