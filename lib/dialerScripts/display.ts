/**
 * How the dialer board words the facts the server hands it. Pure, and free of `server-only`, so the
 * workspace (a client component) and the service can both use it.
 */

/** The board's High / Medium / Low. From the serving TIER — never from the score (LA-2.13). */
export type QueuePriority = "High" | "Medium" | "Low";

export function priorityForTier(tierName: string | null | undefined): QueuePriority {
  if (tierName === "realtime" || tierName === "callback" || tierName === "appointment") return "High";
  if (tierName === "retry") return "Medium";
  return "Low";
}

/** The tiers each filter button narrows the preview to, as serve_next_lead numbers them. */
export const PRIORITY_TIERS: Record<QueuePriority, number[]> = { High: [1, 2, 3], Medium: [4], Low: [5, 6] };

/** "(312) 555–0148" for a US number, the digits as given otherwise. */
export function formatUsPhone(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return String(value ?? "").trim();
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}–${ten.slice(6)}`;
}

/**
 * The short US zone name the board prints ("CT"). Generic rather than daylight-specific, because
 * "CDT" in November is wrong and "CT" never is. Unknown zones fall back to the IANA city.
 */
const ZONE_SHORT: Record<string, string> = {
  "America/New_York": "ET",
  "America/Indiana/Indianapolis": "ET",
  "America/Detroit": "ET",
  "America/Chicago": "CT",
  "America/Denver": "MT",
  "America/Phoenix": "MST",
  "America/Los_Angeles": "PT",
  "America/Anchorage": "AKT",
  "Pacific/Honolulu": "HT",
};

export function zoneShort(zone: string | null | undefined): string {
  if (!zone) return "";
  return ZONE_SHORT[zone] ?? zone.split("/").pop()?.replaceAll("_", " ") ?? zone;
}

/** Minute of the day as the board prints a clock: 1200 → "8:00 PM". */
export function minuteLabel(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** The customer's wall clock at an instant: "10:42 AM". */
export function localClock(at: string | number | Date, zone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

/** The same, 24-hour, as the queue rows print it: "10:42", "21:12". */
export function localClock24(at: string | number | Date, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
}

/** A campaign's lead type as the board's Source row reads it. */
export function sourceLabel(leadType: string | null | undefined): string {
  if (leadType === "list") return "List import";
  if (leadType === "realtime") return "Real-time post";
  if (leadType === "aged") return "Aged";
  return "—";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Sep", with the year only when it is not the current one. UTC, so it is the same everywhere. */
export function shortDate(value: string | null | undefined, now: Date = new Date()): string {
  const at = new Date(String(value ?? ""));
  if (Number.isNaN(at.getTime())) return "";
  const label = `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
  return at.getUTCFullYear() === now.getUTCFullYear() ? label : `${label} ${at.getUTCFullYear()}`;
}

/** "Yes · TrustedForm, 12 Sep" / "None on file" — the board's Consent row, from the stored artefact. */
export function consentLabel(consent: { hasCertificate: boolean; provider: string | null; consentTimestamp: string | null; status: string | null }, now: Date = new Date()): string {
  const provider = consent.provider ? providerName(consent.provider) : null;
  const date = shortDate(consent.consentTimestamp, now);
  if (consent.hasCertificate) return ["Yes", [provider, date].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  if (consent.provider || consent.status) return `No certificate${provider ? ` · ${provider}` : ""}${consent.status ? ` (${consent.status.replaceAll("_", " ")})` : ""}`;
  return "None on file";
}

const PROVIDERS: Record<string, string> = { trustedform: "TrustedForm", jornaya: "Jornaya", leadid: "Jornaya LeadiD" };

export function providerName(provider: string): string {
  const key = provider.trim().toLowerCase().replace(/[\s_-]+/g, "");
  return PROVIDERS[key] ?? provider;
}

/** Why a closed window is closed, from tenant_dial_window's reason code. */
export function windowClosedLabel(reason: string, startMinute: number | null, zone: string | null): string {
  const tz = zoneShort(zone);
  switch (reason) {
    case "before_open":
      return startMinute === null ? "Closed · not open yet" : `Closed · opens ${minuteLabel(startMinute)}${tz ? ` ${tz}` : ""}`;
    case "after_close":
      return "Closed for today";
    case "state_no_sunday":
      return "Closed · the state bars Sunday calls";
    case "agency_no_sunday":
      return "Closed · your agency does not call on Sundays";
    case "state_holiday":
      return "Closed · a state holiday";
    case "federal_holiday":
      return "Closed · a federal holiday";
    case "no_window":
      return "Closed · the rules leave no window today";
    case "rules_stale":
      return "Refused · the calling rules are out of date";
    case "no_state":
      return "Unknown · the lead has no state";
    case "no_zone":
      return "Unknown · no timezone for this state";
    default:
      return "Closed";
  }
}

/** The sentence for a pick the server refused, from serve_lead_by_id's code. */
export function pickRefusalMessage(code: string): string {
  const [head, detail] = code.split(":");
  switch (head) {
    case "taken":
      return "Another agent took this lead a moment ago.";
    case "not_found":
      return "This lead is no longer in the queue.";
    case "exhausted":
      return "This lead has used all its attempts.";
    case "campaign_not_servable":
      return "Its campaign is paused or has not been scrubbed, so it is not dialable.";
    case "suppressed":
      return detail === "tcpa_litigator"
        ? "The number is on a litigator list. It is never dialed."
        : detail === "internal"
          ? "The number is on your agency's do-not-call list."
          : "The number is on a do-not-call list.";
    case "outside_window":
      return "Outside the customer's calling window right now.";
    case "not_licensed":
      return "You are not licensed in this lead's state.";
    case "not_due":
      return "Not due yet: its retry timer or slot has not come round.";
    case "at_capacity":
      return "You are at your open-lead limit, so a lead from the pool is not yours to take. Leads assigned to you are still served.";
    default:
      return "The server refused this pick.";
  }
}

/**
 * The DEFAULT attempt ceiling. `schedule_next_attempt` (latest 20260925706600) stops at
 * `v_ceiling := coalesce(v_lead_ceiling, 7)`: a lead's own `agent_leads.attempt_ceiling` (a recycle
 * batch sets it, 1–7) when there is one, seven otherwise. A test pins both halves to the SQL.
 */
export const DIAL_ATTEMPT_CEILING = 7;

/** The ceiling the scheduler uses for this lead: its own when set, the default otherwise. */
export function leadAttemptCeiling(ceiling: number | null | undefined): number {
  return typeof ceiling === "number" && Number.isInteger(ceiling) && ceiling >= 1 ? ceiling : DIAL_ATTEMPT_CEILING;
}

/** "Attempt 3 of 7" (or "of 3" for a recycled lead). Past the ceiling it just counts. */
export function attemptOfCeiling(attemptsMade: number, ceiling?: number | null): string {
  const next = Math.max(0, Math.floor(attemptsMade)) + 1;
  const max = leadAttemptCeiling(ceiling);
  return next <= max ? `Attempt ${next} of ${max}` : `Attempt ${next}`;
}

/**
 * The six slots `current_slot_for_state` puts a dial in (20260913330000), in the customer's day:
 * weekend wins over the hour, then before 10, before 12, before 15, before 18, after.
 */
export const DIAL_SLOTS = ["early_morning", "late_morning", "afternoon", "early_evening", "late_evening", "weekend"] as const;
export type DialSlot = (typeof DIAL_SLOTS)[number];

const SLOT_LABELS: Record<string, string> = {
  early_morning: "Early morning",
  late_morning: "Late morning",
  afternoon: "Afternoon",
  early_evening: "Early evening",
  late_evening: "Late evening",
  weekend: "Weekend",
  // Cadence preferences a rule can store (20260924230300); only ever a preference, never a dial's slot.
  morning: "Morning",
  evening: "Evening",
  opposite_half: "Opposite half of the day",
};

export function slotLabel(slot: string | null | undefined): string {
  if (!slot) return "—";
  return SLOT_LABELS[slot] ?? slot.replaceAll("_", " ");
}

/**
 * Which slots this lead has been dialled in, the last outcome in each, and the ones not yet tried.
 * From the call history the panel already holds (`tenant_call_attempts.slot`), newest first. An
 * attempt that was never dialled does not count as a try — the scheduler reads dialled slots only.
 */
export function slotsTried(history: Array<{ slot: string; attemptedAt: string; disposition: string | null; dialClicked: boolean }>): {
  tried: Array<{ slot: string; attemptedAt: string; disposition: string | null }>;
  untried: DialSlot[];
} {
  const seen = new Map<string, { slot: string; attemptedAt: string; disposition: string | null }>();
  for (const row of history) {
    if (!row.slot || !row.dialClicked) continue;
    const current = seen.get(row.slot);
    if (!current || Date.parse(row.attemptedAt) > Date.parse(current.attemptedAt)) seen.set(row.slot, { slot: row.slot, attemptedAt: row.attemptedAt, disposition: row.disposition });
  }
  const tried = [...seen.values()].sort((a, b) => Date.parse(a.attemptedAt) - Date.parse(b.attemptedAt));
  return { tried, untried: DIAL_SLOTS.filter((slot) => !seen.has(slot)) };
}

/** The stored suppression lists the dial re-checks (tenant_phone_suppression_hits, 20260925700200), in display order. */
export const SUPPRESSION_LISTS = [
  { key: "tcpa_litigator", label: "TCPA litigator" },
  { key: "federal_dnc", label: "Federal DNC" },
  { key: "state_dnc", label: "State DNC" },
  { key: "internal", label: "Your internal list" },
  { key: "invalid", label: "Invalid number" },
] as const;

export function suppressionListLabel(key: string): string {
  return SUPPRESSION_LISTS.find((list) => list.key === key)?.label ?? key.replaceAll("_", " ");
}

/** "Dialing is blocked because this number is on the TCPA litigator list and the Federal DNC list." */
export function suppressionRefusal(listTypes: string[]): string {
  const names = [...new Set(listTypes)].map((key) => (key === "internal" ? "your agency's do-not-call list" : `the ${suppressionListLabel(key)} list`));
  if (!names.length) return "Dialing is blocked because this number is on a suppression list.";
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Dialing is blocked because this number is on ${joined}.`;
}

/**
 * The served lead's reason as a list. serve_next_lead writes one sentence — the tier's reason, then
 * " — " and score_lead's reasons joined by "; " (20260924323000) — so the parts are split back out.
 */
export function selectionReasonParts(reason: string | null | undefined): string[] {
  const text = String(reason ?? "").trim();
  if (!text) return [];
  const [tier, ...rest] = text.split(" — ");
  const parts = [tier, ...rest.join(" — ").split(";")].map((part) => part.trim().replace(/\.$/, "")).filter(Boolean);
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1));
}

/** lead_return_window (20260925700100), as the Wrong number / Disconnected confirm line reads it. */
export type ReturnWindow = {
  vendorName: string | null;
  campaignName: string | null;
  daysRemaining: number | null;
  claimableUntil: string | null;
  claimable: boolean;
  reason: string | null;
};

export function returnWindowLine(window: ReturnWindow | null | undefined): string {
  if (!window) return "Not claimable: the return window could not be read.";
  if (window.claimable) {
    const days = window.daysRemaining ?? 0;
    return `Claimable from ${window.vendorName ?? "the vendor"} · ${days === 0 ? "last day" : `${days} ${days === 1 ? "day" : "days"} left`} in the return window.`;
  }
  switch (window.reason) {
    case "no_campaign":
      return "Not claimable: this lead did not come from a vendor campaign.";
    case "no_return_window":
      return `Not claimable: ${window.vendorName ?? "the vendor"} has no return window.`;
    case "window_closed":
      return `Not claimable: ${window.vendorName ?? "the vendor"}'s return window has closed.`;
    case "already_claimed":
      return "Not claimable: this lead is already on a return claim.";
    default:
      return "Not claimable.";
  }
}

/** The empty-queue sentence when the open-lead ceiling is why nothing was served. */
export function capacityEmptyReason(open: number, max: number): string {
  return `You have ${open.toLocaleString()} open ${open === 1 ? "lead" : "leads"} and your limit is ${max.toLocaleString()}, so Serve next only serves leads already assigned to you — and none is due now. Finish or disposition some of your open leads to take new ones from the pool.`;
}

/** Cents per record as the card prints it: "$0.36 / lead". */
export function costPerLeadLabel(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toFixed(2)} / lead`;
}
