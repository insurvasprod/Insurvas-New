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

export function customerTimezone(values: Record<string, unknown>): string {
  return STATE_TIMEZONES[stateFromLeadValues(values) ?? ""] ?? "America/New_York";
}

export function customerName(values: Record<string, unknown>): string {
  const composed = [values.first_name, values.last_name].filter(Boolean).join(" ");
  return String(values.full_name ?? values.name ?? composed ?? "Customer") || "Customer";
}

export function formatInTimezone(value: string, timezone: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short", ...options }).format(new Date(value));
}
