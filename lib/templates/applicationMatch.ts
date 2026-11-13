// Settings r8, Application forms A2 / A6: where a question's answer lands on the carrier application.
// Answers reach the application by field name, through the same synonyms the prefill reads
// (lib/applications/prefill.ts), so this shows that match openly instead of leaving it a guess.
// Client-safe.

import { applicationKeysForLeadKeys } from "../applications/prefill.ts";

const APPLICATION_LABELS: Record<string, string> = {
  "insured.first_name": "Insured first name",
  "insured.last_name": "Insured last name",
  "insured.middle_initial": "Middle initial",
  "insured.dob": "Date of birth",
  "insured.gender": "Gender",
  "insured.ssn": "Social Security number",
  "insured.height_in": "Height",
  "insured.weight_lb": "Weight",
  "insured.tobacco": "Tobacco use",
  "contact.phone": "Phone",
  "contact.email": "Email",
  "addr.line1": "Street address",
  "addr.line2": "Apartment or unit",
  "addr.city": "City",
  "addr.state": "State",
  "addr.zip": "ZIP code",
};

/** The application fields one lead field fills, in plain words; empty when it fills none. */
export function applicationFieldsFor(fieldKey: string): string[] {
  const keys = [...applicationKeysForLeadKeys([fieldKey])];
  if (fieldKey === "full_name" || fieldKey === "name") return ["Insured name"];
  return keys.map((key) => APPLICATION_LABELS[key] ?? key);
}

/** How many of these questions reach the application. */
export function matchedCount(fieldKeys: string[]) {
  return fieldKeys.filter((key) => applicationFieldsFor(key).length > 0).length;
}
