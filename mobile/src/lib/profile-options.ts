/**
 * The web's own lists for My profile (components/app/own-profile-form.tsx): the workspace time zones
 * (lib/agencyProfile/types.ts WORKSPACE_TIMEZONES) and the languages routing pairs callers by
 * (lib/transferInbox/constants.ts LANGUAGE_CODES). The stored value stays the IANA name / the word.
 */
export const ZONES: { key: string; label: string }[] = [
  { key: "America/New_York", label: "Eastern · New York" },
  { key: "America/Chicago", label: "Central · Chicago" },
  { key: "America/Denver", label: "Mountain · Denver" },
  { key: "America/Phoenix", label: "Arizona · Phoenix" },
  { key: "America/Los_Angeles", label: "Pacific · Los Angeles" },
  { key: "America/Anchorage", label: "Alaska · Anchorage" },
  { key: "Pacific/Honolulu", label: "Hawaii · Honolulu" },
  { key: "America/Puerto_Rico", label: "Atlantic · Puerto Rico" },
];

/** Null on the server means "the agency's time zone". */
export const AGENCY_ZONE = "";

export function zoneLabel(zone: string | null): string {
  if (!zone) return "The agency’s time zone";
  return ZONES.find((z) => z.key === zone)?.label ?? zone.replace(/_/g, " ");
}

export const LANGUAGES = ["English", "Spanish", "French", "Portuguese", "Chinese", "Vietnamese", "Korean", "Tagalog", "Arabic", "Russian", "Haitian Creole"];

/** "spanish" / "es" / "Spanish" all read "Spanish". */
export function languageWord(value: string): string {
  const v = value.trim().toLowerCase();
  const codes: Record<string, string> = { es: "spanish", en: "english", fr: "french", pt: "portuguese", zh: "chinese", vi: "vietnamese", ko: "korean", tl: "tagalog", ar: "arabic", ru: "russian", ht: "haitian creole" };
  const key = /^[a-z]{2,3}([-_][a-z0-9]{2,8})?$/.test(v) ? codes[v.split(/[-_]/)[0]] ?? v : v;
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}
