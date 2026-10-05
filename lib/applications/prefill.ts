// Lead values → canonical application keys (LA-3.7 prefill). Pure and client-safe.
//
// Lead forms are tenant-configured, so their keys vary: "full_name" or "first_name"/"last_name",
// "date_of_birth" or "dob", "zip" or "zip_code". This reads the synonyms a lead is known to use and
// nothing else — a value we cannot place confidently is left for the agent, never guessed into a
// field (LA-3.13's "never guess" applies to our own record too).

import { digitsOnly } from "../templates/formats.ts";

type LeadValues = Record<string, unknown>;

const SYNONYMS: Record<string, readonly string[]> = {
  "insured.first_name": ["first_name", "firstname", "given_name"],
  "insured.last_name": ["last_name", "lastname", "surname", "family_name"],
  "insured.middle_initial": ["middle_initial", "middle_name"],
  "insured.dob": ["date_of_birth", "dob", "birth_date", "birthdate"],
  "insured.gender": ["gender", "sex"],
  "insured.ssn": ["ssn", "social_security_number", "social_security"],
  "insured.height_in": ["height_in", "height_inches", "height"],
  "insured.weight_lb": ["weight_lb", "weight_lbs", "weight"],
  "insured.tobacco": ["tobacco", "tobacco_use", "smoker"],
  "contact.phone": ["phone", "phone_number", "mobile", "cell"],
  "contact.email": ["email", "email_address"],
  "addr.line1": ["address_line1", "address1", "street", "street_address", "address"],
  "addr.line2": ["address_line2", "address2", "apt", "unit"],
  "addr.city": ["city"],
  "addr.state": ["state", "state_code"],
  "addr.zip": ["zip", "zip_code", "postal_code", "zipcode"],
};

function first(values: LeadValues, keys: readonly string[]) {
  for (const k of keys) {
    const v = values[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function isoDate(v: unknown): string | null {
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

export type PrefillValue = { key: string; value: string | number | boolean; sensitive: boolean };

/**
 * The application values a selected quote's frozen rating inputs supply (LA-3.7: "creating an
 * application from a selected quote prefills … DOB, gender, tobacco"). The Quote step keys them the
 * way the quotation template does (`dob`, `gender`, `state`, `tobacco`); anything it can't read
 * confidently is left out.
 */
export function prefillFromQuote(ratingInputs: Record<string, unknown> | null | undefined): { key: string; value: string }[] {
  const r = ratingInputs ?? {};
  const out: { key: string; value: string }[] = [];
  const dob = typeof r.dob === "string" ? isoDate(r.dob) : null;
  if (dob) out.push({ key: "insured.dob", value: dob });
  const g = typeof r.gender === "string" ? r.gender.trim().toLowerCase() : "";
  if (g === "female" || g === "f") out.push({ key: "insured.gender", value: "female" });
  else if (g === "male" || g === "m") out.push({ key: "insured.gender", value: "male" });
  const t = r.tobacco === true ? "yes" : r.tobacco === false ? "no" : typeof r.tobacco === "string" ? r.tobacco.trim().toLowerCase() : "";
  if (["yes", "y", "true"].includes(t)) out.push({ key: "insured.tobacco", value: "yes" });
  else if (["no", "n", "false"].includes(t)) out.push({ key: "insured.tobacco", value: "no" });
  const s = typeof r.state === "string" ? r.state.trim() : "";
  if (/^[A-Za-z]{2}$/.test(s)) out.push({ key: "addr.state", value: s.toUpperCase() });
  return out;
}

/** Interview answers that are also application fields: height and weight read off the build chart, tobacco. */
export const INTERVIEW_SYNONYMS: Record<string, readonly string[]> = {
  "insured.height_in": ["height_in", "height_inches", "height"],
  "insured.weight_lb": ["weight_lb", "weight_lbs", "weight"],
  "insured.tobacco": ["tobacco", "tobacco_use", "tobacco_12m", "smoker"],
};

/**
 * The application fields an underwriting question can fill, as the template builder offers them
 * ("Fills on the application"). Picking one gives the question `key`, the first synonym above, so
 * the answer reaches the application, the Quote step and "Applies to: tobacco users" with no other
 * wiring. `types` are the answer types that can carry it (a single choice is Yes / No / Unsure).
 */
export const INTERVIEW_FEEDS = [
  { field: "insured.height_in", key: "height_in", label: "Height (inches)", types: ["number"] },
  { field: "insured.weight_lb", key: "weight_lb", label: "Weight (pounds)", types: ["number"] },
  { field: "insured.tobacco", key: "tobacco", label: "Tobacco in the last 12 months", types: ["boolean", "single_select"] },
] as const;
export type InterviewFeed = (typeof INTERVIEW_FEEDS)[number];

/** The feed a question key already fills, by any of its synonyms — or null. */
export function feedOfQuestionKey(key: string): InterviewFeed | null {
  return INTERVIEW_FEEDS.find((f) => INTERVIEW_SYNONYMS[f.field]?.includes(key)) ?? null;
}

/** Interview question keys whose answer is also an application value (the workspace re-reads on them). */
export const INTERVIEW_VALUE_KEYS: ReadonlySet<string> = new Set(Object.values(INTERVIEW_SYNONYMS).flat());

/**
 * The application values the interview's answers supply (LA-3.2 → LA-3.7): asked once on the call,
 * not again on the Application step. Only answers that read confidently; a cleared answer is not a value.
 */
export function prefillFromInterview(answers: Record<string, unknown>): { key: string; value: string | number }[] {
  const out: { key: string; value: string | number }[] = [];
  for (const key of ["insured.height_in", "insured.weight_lb"] as const) {
    const v = first(answers, INTERVIEW_SYNONYMS[key]);
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    if (Number.isFinite(n) && n > 0) out.push({ key, value: Math.round(n) });
  }
  const t = first(answers, INTERVIEW_SYNONYMS["insured.tobacco"]);
  if (t === true || (typeof t === "string" && ["yes", "true"].includes(t.trim().toLowerCase()))) out.push({ key: "insured.tobacco", value: "yes" });
  else if (t === false || (typeof t === "string" && ["no", "false"].includes(t.trim().toLowerCase()))) out.push({ key: "insured.tobacco", value: "no" });
  return out;
}

/**
 * Sources an interview answer may replace: a guess from the lead, the last attempt, the quote's
 * rating assumption, or an earlier answer. Never what a person typed, never a shared household value.
 */
export const INTERVIEW_MAY_REPLACE: readonly string[] = ["lead", "carried_forward", "quote", "interview"];

/** Sources a quote's value may replace: what the lead or the last attempt guessed. Never what a person typed. */
export const QUOTE_MAY_REPLACE: readonly string[] = ["lead", "carried_forward", "quote"];

/** Every canonical value the lead can supply, normalised. Sensitive ones are flagged for encryption. */
export function prefillFromLead(values: LeadValues): PrefillValue[] {
  const out: PrefillValue[] = [];
  const put = (key: string, value: string | number | boolean | null | undefined, sensitive = false) => {
    if (value === null || value === undefined || value === "") return;
    out.push({ key, value, sensitive });
  };

  let firstName = first(values, SYNONYMS["insured.first_name"]);
  let lastName = first(values, SYNONYMS["insured.last_name"]);
  const full = first(values, ["full_name", "name"]);
  if ((!firstName || !lastName) && typeof full === "string") {
    const parts = full.trim().split(/\s+/);
    if (parts.length >= 2) {
      firstName ??= parts[0];
      lastName ??= parts[parts.length - 1];
      if (parts.length === 3 && parts[1].replace(".", "").length === 1) put("insured.middle_initial", parts[1].replace(".", "").toUpperCase());
    }
  }
  put("insured.first_name", firstName ? String(firstName).trim() : null);
  put("insured.last_name", lastName ? String(lastName).trim() : null);
  const mi = first(values, SYNONYMS["insured.middle_initial"]);
  if (mi) put("insured.middle_initial", String(mi).trim().charAt(0).toUpperCase());

  const dob = first(values, SYNONYMS["insured.dob"]);
  put("insured.dob", dob ? isoDate(dob) : null);

  const gender = first(values, SYNONYMS["insured.gender"]);
  if (gender) {
    const g = String(gender).trim().toLowerCase();
    put("insured.gender", g.startsWith("f") ? "female" : g.startsWith("m") ? "male" : null);
  }

  const ssn = first(values, SYNONYMS["insured.ssn"]);
  if (ssn && digitsOnly(String(ssn)).length === 9) put("insured.ssn", digitsOnly(String(ssn)), true);

  for (const key of ["insured.height_in", "insured.weight_lb"] as const) {
    const v = first(values, SYNONYMS[key]);
    const n = v === undefined ? NaN : Number(String(v).replace(/[^\d.]/g, ""));
    if (Number.isFinite(n) && n > 0) put(key, Math.round(n));
  }

  const tobacco = first(values, SYNONYMS["insured.tobacco"]);
  if (tobacco !== undefined) {
    const t = String(tobacco).trim().toLowerCase();
    put("insured.tobacco", ["true", "yes", "y", "1"].includes(t) ? "yes" : ["false", "no", "n", "0"].includes(t) ? "no" : null);
  }

  const phone = first(values, SYNONYMS["contact.phone"]);
  if (phone) {
    const d = digitsOnly(String(phone)).replace(/^1(?=\d{10}$)/, "");
    put("contact.phone", d.length === 10 ? d : null);
  }
  const email = first(values, SYNONYMS["contact.email"]);
  put("contact.email", email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim()) ? String(email).trim() : null);

  for (const key of ["addr.line1", "addr.line2", "addr.city"] as const) {
    const v = first(values, SYNONYMS[key]);
    put(key, v ? String(v).trim() : null);
  }
  const state = first(values, SYNONYMS["addr.state"]);
  put("addr.state", state && /^[A-Za-z]{2}$/.test(String(state).trim()) ? String(state).trim().toUpperCase() : null);
  const zip = first(values, SYNONYMS["addr.zip"]);
  if (zip) {
    const z = digitsOnly(String(zip));
    put("addr.zip", z.length === 5 || z.length === 9 ? z.slice(0, 5) : null);
  }
  return out;
}
