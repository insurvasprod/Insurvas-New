// Client-safe: the Clean screen and the route share these (the service is server-only).

export type LeadDuplicateDecision = "same_person" | "separate";

export const LEAD_DUPLICATE_DECISIONS: readonly LeadDuplicateDecision[] = ["same_person", "separate"];

export function leadDuplicateDecisionError(value: unknown): string | null {
  return LEAD_DUPLICATE_DECISIONS.includes(value as LeadDuplicateDecision) ? null : "Answer same_person or separate";
}

/** One side of a same-phone question: a lead (with its id) or a re-imported row (no id yet). */
export type LeadDuplicateSide = {
  leadId: string | null;
  values: Record<string, string>;
  createdAt: string | null;
  campaign: string | null;
};

export type LeadDuplicateItem = {
  id: string;
  phone: string;
  /** reimport: a row attached to a lead it matched; pair: two leads that already share the number. */
  kind: "reimport" | "pair";
  createdAt: string;
  existing: LeadDuplicateSide;
  incoming: LeadDuplicateSide;
};

export type LeadDuplicateQueue = { ready: boolean; total: number; index: number; item: LeadDuplicateItem | null };

/** The fields compared, in the order shown; a field neither side has is left out. */
export const LEAD_DUPLICATE_FIELDS: ReadonlyArray<{ key: string; label: string; keys: readonly string[] }> = [
  { key: "name", label: "Name", keys: ["full_name", "name"] },
  { key: "first_name", label: "First name", keys: ["first_name"] },
  { key: "last_name", label: "Last name", keys: ["last_name"] },
  { key: "dob", label: "Date of birth", keys: ["dob", "date_of_birth"] },
  { key: "email", label: "Email", keys: ["email"] },
  { key: "address", label: "Address", keys: ["address_line1", "address", "street_address"] },
  { key: "city", label: "City", keys: ["city"] },
  { key: "state", label: "State", keys: ["state", "state_code"] },
  { key: "zip", label: "ZIP", keys: ["postal_code", "zip", "zip_code"] },
];

export function leadFieldValue(values: Record<string, string>, keys: readonly string[]): string | null {
  for (const key of keys) if (values[key]) return values[key];
  return null;
}

export function leadDisplayName(values: Record<string, string>): string {
  const full = leadFieldValue(values, ["full_name", "name"]);
  if (full) return full;
  return [values.first_name, values.last_name].filter(Boolean).join(" ") || "This person";
}
