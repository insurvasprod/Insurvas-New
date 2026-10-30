/**
 * Lead posting · "Check a sample post" (owner pick A, 2026-10-30). The owner pastes one payload a
 * vendor sends and sees, before any real lead arrives, what the post path would make of it: the
 * field map guessed from its names, and the field checks in the order acceptPostedLead runs them.
 *
 * Nothing is posted, stored or logged: a real test post would put a lead on the dialer. So this is
 * the field half of the post path only, and the screen says which checks it cannot run here (the
 * campaign, the licence, the Do Not Call scrub and the duplicate check all read the database).
 *
 * Plain module — no `server-only`, no path aliases — so the screen and a `node --test` file read it.
 */
import { applyFieldMap, OUR_FIELD_PATTERN } from "./fieldMap.ts";
import { consentIpOf, consentTextOf, parseUsDateOfBirth } from "./validation.ts";

/** Their usual names for our fields, compared with case, spaces, dashes and underscores removed. */
const ALIASES: Record<string, string[]> = {
  first_name: ["firstname", "fname", "first", "givenname"],
  last_name: ["lastname", "lname", "last", "surname", "familyname"],
  full_name: ["fullname", "name"],
  phone: ["phone", "phone1", "ph", "ph1", "phonenumber", "primaryphone", "cell", "cellphone", "mobile", "mobilephone", "homephone", "tel", "telephone"],
  email: ["email", "emailaddress", "mail"],
  state: ["state", "st", "statecode", "region"],
  zip: ["zip", "zipcode", "postalcode", "postcode"],
  city: ["city", "town"],
  address: ["address", "address1", "street", "streetaddress"],
  date_of_birth: ["dob", "dateofbirth", "birthdate", "birthday", "bday"],
  gender: ["gender", "sex"],
  consent_text: ["consenttext", "consent", "tcpatext", "tcpaconsent", "tcpalanguage", "disclosure"],
  consent_ip: ["consentip", "ipaddress", "ip", "userip", "clientip"],
  consent_timestamp: ["consenttimestamp", "consenttime", "optintime", "timestamp"],
  trusted_form_cert_url: ["trustedformcerturl", "xxtrustedformcerturl", "trustedform", "trustedformurl", "certurl"],
  jornaya_leadid: ["jornayaleadid", "leadidtoken", "universalleadid", "jornaya", "leadid"],
  source_url: ["sourceurl", "pageurl", "url"],
  landing_page: ["landingpage", "lp"],
  product_line: ["productline", "product", "vertical"],
};

const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const BY_ALIAS = new Map<string, string>();
for (const [ours, names] of Object.entries(ALIASES)) for (const name of names) if (!BY_ALIAS.has(name)) BY_ALIAS.set(name, ours);

/** A pasted payload: JSON, or a form-encoded line (`fname=Ana&st=TX`), which some vendors post. */
export function parseSample(text: string): { payload: Record<string, unknown> } | { error: string } {
  const raw = text.trim();
  if (!raw) return { error: "Paste one of their payloads." };
  if (raw.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { payload: parsed as Record<string, unknown> };
      return { error: "That is JSON, but not one lead object." };
    } catch {
      return { error: "That JSON does not parse. Check for a missing quote or comma." };
    }
  }
  if (raw.includes("=")) {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of new URLSearchParams(raw)) payload[key] = value;
    if (Object.keys(payload).length) return { payload };
  }
  return { error: "Paste the payload as JSON, or as name=value pairs joined with &." };
}

/**
 * Our field for each of their top-level names, where the name says it plainly. A name that already
 * is ours needs no row; a name we cannot place is left for the owner. Rows the map already holds win.
 */
export function guessFieldMap(payload: Record<string, unknown>, existing: { ours: string; theirs: string }[] = []): { ours: string; theirs: string }[] {
  const taken = new Set(existing.map((row) => row.ours));
  const used = new Set(existing.map((row) => row.theirs));
  const out: { ours: string; theirs: string }[] = [];
  for (const theirs of Object.keys(payload)) {
    if (used.has(theirs)) continue;
    const ours = BY_ALIAS.get(squash(theirs));
    if (!ours || ours === theirs || taken.has(ours) || !OUR_FIELD_PATTERN.test(ours)) continue;
    taken.add(ours);
    out.push({ ours, theirs });
  }
  return out;
}

export type SampleCheck = { label: string; ok: boolean; detail: string; reasonCode?: string };

/** The field checks of the post path, in its order. The first failure is the reason a vendor would get. */
export function checkSample(payload: Record<string, unknown>, map: Record<string, string>): { checks: SampleCheck[]; reasonCode: string | null } {
  const values = applyFieldMap(payload, map);
  const checks: SampleCheck[] = [];

  const rawPhone = values.phone ?? values.phone_number ?? values.primary_phone;
  const digits = String(rawPhone ?? "").replace(/[^0-9]/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const phoneOk = /^[0-9]{10}$/.test(ten);
  checks.push(phoneOk
    ? { label: "Phone", ok: true, detail: `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` }
    : { label: "Phone", ok: false, detail: rawPhone === undefined ? "No phone field after the map" : `"${String(rawPhone)}" is not a 10-digit US number`, reasonCode: "invalid_phone" });

  const state = typeof values.state === "string" && /^[A-Za-z]{2}$/.test(values.state.trim()) ? values.state.trim().toUpperCase() : null;
  checks.push(state
    ? { label: "State", ok: true, detail: state }
    : { label: "State", ok: false, detail: values.state === undefined ? "No state field after the map" : `"${String(values.state)}" is not a two-letter state`, reasonCode: "unknown_state" });

  const first = typeof values.first_name === "string" ? values.first_name.trim() : "";
  const last = typeof values.last_name === "string" ? values.last_name.trim() : "";
  const full = typeof values.full_name === "string" ? values.full_name.trim() : "";
  checks.push(first || last || full
    ? { label: "Name", ok: true, detail: [first, last].filter(Boolean).join(" ") || full }
    : { label: "Name", ok: false, detail: "No first, last or full name after the map", reasonCode: "missing_required_field" });

  const consentText = consentTextOf(values);
  checks.push(consentText
    ? { label: "Consent text", ok: true, detail: consentText.length > 60 ? `${consentText.slice(0, 60)}…` : consentText }
    : { label: "Consent text", ok: false, detail: "No consent_text: what the person agreed to", reasonCode: "missing_consent_text" });

  const consentIp = consentIpOf(values);
  checks.push(consentIp
    ? { label: "Consent IP", ok: true, detail: consentIp }
    : { label: "Consent IP", ok: false, detail: "No consent_ip (or ip) the person agreed from", reasonCode: "missing_consent_ip" });

  const dob = parseUsDateOfBirth(values.date_of_birth);
  checks.push(dob.status === "invalid"
    ? { label: "Date of birth", ok: false, detail: `"${String(values.date_of_birth)}" cannot be read`, reasonCode: "invalid_date_of_birth" }
    : { label: "Date of birth", ok: true, detail: dob.status === "ok" ? dob.iso : "Not sent (allowed)" });

  return { checks, reasonCode: checks.find((check) => !check.ok)?.reasonCode ?? null };
}

/** What a real post checks that a pasted sample cannot, because each reads your data. */
export const NOT_CHECKED_HERE = ["the campaign is accepting leads", "a current licence in the lead's state", "the Do Not Call and litigator scrub", "whether the lead is already yours"] as const;
