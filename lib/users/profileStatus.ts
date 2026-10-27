/**
 * Settings › My profile: the one line under each tab card that says what needs you (redesign
 * 2026-10-27, layout B). Pure, so the words are tested and the tabs only draw them.
 *
 * A status that is not known yet says so ("Checking…"); it never claims "done" while a read is out.
 */

export type StatusTone = "warn" | "good" | "calm";
export type TabStatus = { text: string; tone: StatusTone };

const CHECKING: TabStatus = { text: "Checking…", tone: "calm" };

export type AboutFacts = {
  phone: string | null;
  licensedStates: string[] | null;
  licenceNumbers: Record<string, string>;
  licenceNumbersReady: boolean;
};

/** Licensed states with no number yet, in the order they are listed. */
export function missingLicenceStates(facts: AboutFacts): string[] {
  if (!facts.licenceNumbersReady || !facts.licensedStates) return [];
  return facts.licensedStates.filter((state) => !(facts.licenceNumbers[state] ?? "").trim());
}

export function aboutStatus(facts: AboutFacts | null, stateName: (code: string) => string = (code) => code): TabStatus {
  if (!facts) return CHECKING;
  const missing = missingLicenceStates(facts);
  if (missing.length === 1) return { text: `${stateName(missing[0])} number not filled in`, tone: "warn" };
  if (missing.length > 1) return { text: `${missing.length} licence numbers not filled in`, tone: "warn" };
  if (!facts.phone) return { text: "No phone number yet", tone: "calm" };
  return { text: "All filled in", tone: "good" };
}

/** "unavailable": the server cannot run two-step sign-in for this account yet (its 503). */
export type TwoStepFacts = { enabled: boolean; required: boolean } | "unavailable";

export function signinStatus(facts: TwoStepFacts | null): TabStatus {
  if (!facts) return CHECKING;
  if (facts === "unavailable") return { text: "Two-step sign-in not ready yet", tone: "calm" };
  if (facts.enabled) return { text: "Two-step sign-in is on", tone: "good" };
  if (facts.required) return { text: "Turn on two-step sign-in", tone: "warn" };
  return { text: "Two-step sign-in is off", tone: "calm" };
}

export type AlertFacts = {
  events: ReadonlyArray<{ protected?: boolean; delivery: { in_app: boolean; email: boolean; push: boolean } }>;
  quiet: { enabled: boolean; start: string; end: string };
};

/** "21:00" → "9 PM", "07:30" → "7:30 AM". */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * Alerts counts only the ones the person can switch — the "Always on" ones are on whatever they do —
 * so the card and the table's "N switched off" agree (final critique, 2026-10-27).
 */
export function alertsStatus(facts: AlertFacts | null): TabStatus {
  if (!facts) return CHECKING;
  const switchable = facts.events.filter((event) => !event.protected);
  const on = switchable.filter(({ delivery }) => delivery.in_app || delivery.email || delivery.push).length;
  if (switchable.length > 0 && on === 0) return { text: "Every alert is off", tone: "warn" };
  const quiet = facts.quiet.enabled ? ` · quiet ${clockLabel(facts.quiet.start)} – ${clockLabel(facts.quiet.end)}` : "";
  return { text: `${on} of ${switchable.length} on${quiet}`, tone: "calm" };
}

export const HISTORY_STATUS: TabStatus = { text: "Your changes and sign-ins", tone: "calm" };

/** How far back a run of wrong passwords still warns on the History card. */
export const RECENT_WRONG_PASSWORD_DAYS = 30;

export type HistoryFacts = ReadonlyArray<{ type: string; at: string; detail?: Record<string, unknown> }>;

/**
 * The History card: calm, unless someone typed wrong passwords at this account lately — then it says
 * how many and when, so it is seen without opening the tab. The newest such run is the one named.
 */
export function historyStatus(events: HistoryFacts | null, now: number, dateLabel: (iso: string) => string): TabStatus {
  if (!events) return HISTORY_STATUS;
  const since = now - RECENT_WRONG_PASSWORD_DAYS * 86_400_000;
  const recent = events
    .filter((event) => event.type === "failed_logins" && Date.parse(event.at) >= since)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!recent) return HISTORY_STATUS;
  const count = Number(recent.detail?.count);
  return { text: `${Number.isFinite(count) && count > 0 ? `${count} ` : ""}wrong passwords on ${dateLabel(recent.at)}`, tone: "warn" };
}

/** What a tab holds, said instead of a status when its read failed: plain, and never a false "done". */
export const TAB_PURPOSE = {
  profile: { text: "Your name, phone and licence numbers", tone: "calm" },
  security: { text: "Email, password and devices", tone: "calm" },
  notifications: { text: "Which alerts reach you", tone: "calm" },
} as const satisfies Record<string, TabStatus>;
