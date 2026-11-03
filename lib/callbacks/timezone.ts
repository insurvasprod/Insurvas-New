export const STATE_TIMEZONES: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago",
  CA: "America/Los_Angeles", CO: "America/Denver", CT: "America/New_York", DE: "America/New_York",
  FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Denver",
  IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago", KS: "America/Chicago",
  KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York", MD: "America/New_York",
  MA: "America/New_York", MI: "America/New_York", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles",
  NH: "America/New_York", NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York",
  NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York", OK: "America/Chicago",
  OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York", SC: "America/New_York",
  SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver",
  VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York",
  WI: "America/Chicago", WY: "America/Denver", DC: "America/New_York",
};

const STATE_KEYS = ["state", "state_code", "resident_state", "residence_state"];

export function stateFromLeadValues(values: Record<string, unknown>): string | null {
  for (const key of STATE_KEYS) {
    const value = values[key];
    if (typeof value === "string" && /^[A-Za-z]{2}$/.test(value.trim())) return value.trim().toUpperCase();
  }
  return null;
}

/**
 * States that span more than one timezone. STATE_TIMEZONES gives each the zone most of it keeps, which
 * is right for a dialable-state list but wrong for a callback: a Pensacola customer is Central, not
 * Eastern. For these, a callback needs the zip code (below) or an explicit zone from the agent.
 */
export const SPLIT_STATES: ReadonlySet<string> = new Set(["AK", "FL", "ID", "IN", "KS", "KY", "MI", "ND", "NE", "OR", "SD", "TN", "TX"]);

/**
 * Three-digit zip prefixes, in split states, that lie wholly in one zone. Deliberately short: a
 * prefix that straddles a zone line (FL 323/324, TX 798, …) is absent, so it asks the agent rather
 * than guessing. Every other prefix of a listed state falls back to that state's `rest` zone only
 * when the state appears here with one.
 */
const SPLIT_STATE_ZIP3: Record<string, { zones: Record<string, string>; rest?: string }> = {
  // Escambia, Santa Rosa, Okaloosa, Walton: Central. 323/324 straddle the line (Gulf, Calhoun, Jackson).
  FL: { zones: { "325": "America/Chicago" }, rest: "America/New_York" },
  // El Paso: Mountain. 798 mixes Hudspeth/Culberson with Brewster/Presidio, so it is left out.
  TX: { zones: { "799": "America/Denver", "885": "America/Denver" }, rest: "America/Chicago" },
};
const SPLIT_REST_EXCLUDED: Record<string, ReadonlySet<string>> = {
  FL: new Set(["323", "324"]),
  TX: new Set(["798"]),
};

/** The zones an agent may pick when the customer's cannot be derived. */
export const US_CUSTOMER_TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles",
  "America/Anchorage", "America/Adak", "Pacific/Honolulu", "America/Indiana/Indianapolis", "America/Boise",
  "America/Detroit", "America/Kentucky/Louisville", "America/North_Dakota/Center", "America/Puerto_Rico",
] as const;

export const CUSTOMER_TIMEZONE_UNKNOWN = "customer_timezone_unknown";
export const CUSTOMER_TIMEZONE_AMBIGUOUS = "customer_timezone_ambiguous";

export type CustomerTimezoneResolution =
  | { ok: true; zone: string; source: "explicit" | "state" | "zip" }
  | { ok: false; code: typeof CUSTOMER_TIMEZONE_UNKNOWN | typeof CUSTOMER_TIMEZONE_AMBIGUOUS; state: string | null; message: string };

const ZIP_KEYS = ["zip", "zip_code", "postal_code", "zipcode", "resident_zip"];

function zip3FromLeadValues(values: Record<string, unknown>): string | null {
  for (const key of ZIP_KEYS) {
    const value = values[key];
    const text = typeof value === "number" ? String(value).padStart(5, "0") : typeof value === "string" ? value.trim() : "";
    if (/^\d{5}(-\d{4})?$/.test(text)) return text.slice(0, 3);
  }
  return null;
}

/** A zone the agent supplied, accepted only from the picker's list. */
export function explicitCustomerTimezone(value: unknown): string | null {
  return typeof value === "string" && (US_CUSTOMER_TIMEZONES as readonly string[]).includes(value) ? value : null;
}

/**
 * The customer's timezone for a callback, or a coded refusal. Never guesses (LA-1.22: "the
 * customer's local timezone is shown, always — derived from their state"): an unknown state, or a
 * split state without a zip that settles it, needs the agent to choose the zone.
 */
export function resolveCustomerTimezone(values: Record<string, unknown>, explicit?: unknown): CustomerTimezoneResolution {
  const chosen = explicitCustomerTimezone(explicit);
  if (chosen) return { ok: true, zone: chosen, source: "explicit" };
  const state = stateFromLeadValues(values);
  const stateZone = state ? STATE_TIMEZONES[state] : undefined;
  if (!state || !stateZone) {
    return { ok: false, code: CUSTOMER_TIMEZONE_UNKNOWN, state, message: "This lead has no state we recognise, so the customer's timezone is unknown. Choose their timezone." };
  }
  if (!SPLIT_STATES.has(state)) return { ok: true, zone: stateZone, source: "state" };
  const zip3 = zip3FromLeadValues(values);
  const table = SPLIT_STATE_ZIP3[state];
  if (zip3 && table) {
    const exact = table.zones[zip3];
    if (exact) return { ok: true, zone: exact, source: "zip" };
    if (table.rest && !SPLIT_REST_EXCLUDED[state]?.has(zip3)) return { ok: true, zone: table.rest, source: "zip" };
  }
  return { ok: false, code: CUSTOMER_TIMEZONE_AMBIGUOUS, state, message: `${state} spans more than one timezone. Choose the customer's timezone.` };
}

/** The customer's timezone when it can be derived, else null — never a guessed default. */
export function customerTimezone(values: Record<string, unknown>): string | null {
  const resolved = resolveCustomerTimezone(values);
  return resolved.ok ? resolved.zone : null;
}

export function customerName(values: Record<string, unknown>): string {
  const composed = [values.first_name, values.last_name].filter(Boolean).join(" ");
  return String(values.full_name ?? values.name ?? composed ?? "Customer") || "Customer";
}

export function formatInTimezone(value: string, timezone: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short", ...options }).format(new Date(value));
}
