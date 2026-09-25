/**
 * The vendor field map: which of THEIR payload fields fills which of OUR lead fields.
 *
 * Plain module — no `server-only`, no path aliases — because the settings screen, the post path
 * and a `node --test` file all read it.
 *
 * ── The stored direction ───────────────────────────────────────────────────
 *
 *   { "<our field>": "<their field or dotted path>" }      e.g. { "phone": "ph1", "state": "contact.st" }
 *
 * That is the post path's contract and always was: the key is the field we write, the value is
 * where to read it in the vendor's payload. Keyed by ours because a lead field has exactly one
 * source, and because the dotted path — `contact.phone` — is a thing only their side has.
 *
 * ── Why a tolerant reader exists ───────────────────────────────────────────
 *
 * Until 2026-09-24 the only way to write a map was a JSON box on the mint dialog that said "Their
 * field name on the left, yours on the right" with the placeholder `{"Phone": "phone"}`. That is the
 * opposite of the contract above. Every map typed as instructed was stored backwards, and applying
 * it did nothing useful: it copied the payload's `phone` into a field called `Phone`, and the
 * vendor's `Phone` was never read.
 *
 * Nothing records which way round a given row was typed, and the database cannot be queried from
 * where this was fixed. So a stored pair is read as inverted when the evidence says so:
 *
 *   1. the key is one of our known fields            → as stored (ours → theirs)
 *   2. otherwise, the VALUE is one of our known fields → inverted (the key is theirs)
 *   3. otherwise, the key is a dotted path and the value a plain field key → inverted
 *   4. otherwise                                     → as stored
 *
 * Rule 1 wins over rule 2, so a correct map that happens to read one known field from another
 * (`{"phone": "phone_number"}`) is never flipped. Rule 4 means a pair of two unknown names is taken
 * at its word — there is no evidence either way, and the contract is the only tie-breaker.
 *
 * The settings screen shows maps through this same reader and saves them back canonically, so a
 * backwards row is corrected the first time anyone saves it.
 */

/** Fields the post path itself reads, plus the common lead fields vendors send. */
export const KNOWN_LEAD_FIELDS = [
  "first_name",
  "last_name",
  "full_name",
  "phone",
  "phone_number",
  "primary_phone",
  "email",
  "state",
  "zip",
  "city",
  "address",
  "date_of_birth",
  "gender",
  "product_line",
  "consent_text",
  "consent_ip",
  "consent_timestamp",
  "ip",
  "trusted_form_cert_url",
  "trustedform_url",
  "jornaya_leadid",
  "source_url",
  "landing_page",
] as const;

const KNOWN = new Set<string>(KNOWN_LEAD_FIELDS);

/** Our side of a map: a lead field key, the same shape template field keys use. */
export const OUR_FIELD_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;

export type FieldMapEntry = {
  /** The lead field we write. */
  ours: string;
  /** Where to read it in the vendor's payload; dotted for nested bodies. */
  theirs: string;
  /** True when the stored pair was the wrong way round and has been read flipped. */
  inverted: boolean;
};

export function isKnownLeadField(name: string): boolean {
  return KNOWN.has(name);
}

/** Read one stored pair, deciding which side is ours. */
export function readFieldMapPair(key: string, value: string): FieldMapEntry {
  if (KNOWN.has(key)) return { ours: key, theirs: value, inverted: false };
  if (KNOWN.has(value)) return { ours: value, theirs: key, inverted: true };
  if (key.includes(".") && !value.includes(".") && OUR_FIELD_PATTERN.test(value)) {
    return { ours: value, theirs: key, inverted: true };
  }
  return { ours: key, theirs: value, inverted: false };
}

/**
 * Every stored pair, read tolerantly. When two pairs claim the same field of ours, the one stored
 * the right way round wins — it is the one somebody typed knowing the contract.
 */
export function readFieldMap(map: Record<string, unknown> | null | undefined): FieldMapEntry[] {
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  const byOurs = new Map<string, FieldMapEntry>();
  for (const [key, raw] of Object.entries(map)) {
    if (typeof raw !== "string" || !key.trim() || !raw.trim()) continue;
    const entry = readFieldMapPair(key.trim(), raw.trim());
    const existing = byOurs.get(entry.ours);
    if (!existing || (existing.inverted && !entry.inverted)) byOurs.set(entry.ours, entry);
  }
  return [...byOurs.values()];
}

/** The canonical stored form: `{ ours: theirs }`. */
export function canonicalFieldMap(entries: { ours: string; theirs: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const ours = entry.ours.trim();
    const theirs = entry.theirs.trim();
    if (ours && theirs) out[ours] = theirs;
  }
  return out;
}

function readPath(payload: Record<string, unknown>, path: string): unknown {
  // A literal key wins over a dotted walk, so a vendor that sends `{"contact.phone": ...}` flat is
  // read as sent.
  if (Object.prototype.hasOwnProperty.call(payload, path)) return payload[path];
  return path
    .split(".")
    .reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), payload);
}

/**
 * Apply the vendor's field map to their payload. Everything they sent is kept; mapped fields are
 * written under our names on top.
 */
export function applyFieldMap(payload: Record<string, unknown>, map: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const entries = readFieldMap(map);
  if (entries.length === 0) return payload;
  const mapped: Record<string, unknown> = { ...payload };
  for (const { ours, theirs } of entries) {
    const value = readPath(payload, theirs);
    if (value !== undefined) mapped[ours] = value;
  }
  return mapped;
}

/**
 * What the post path does with a field once it arrives — true statements only, each one checked
 * against `acceptPostedLead`. A field with no entry here is stored on the lead as sent.
 */
export const FIELD_RULES: Record<string, string> = {
  phone: "Reduced to 10 digits, a leading 1 dropped; anything else is rejected as an invalid phone",
  phone_number: "Read when phone is absent; same 10-digit rule",
  primary_phone: "Read when phone and phone_number are absent; same 10-digit rule",
  state: "Two letters, upper-cased; required, and the agency must hold a current licence there, or the post is rejected",
  first_name: "A first, last or full name is required",
  last_name: "A first, last or full name is required",
  full_name: "A first, last or full name is required",
  product_line: "Picks the intake template; term_life when absent",
  date_of_birth: "Parsed as US month-first and stored as YYYY-MM-DD; a date that cannot be read is rejected",
  consent_text: "Stored verbatim, never edited; required, or the row is rejected",
  consent_ip: "Required, or the row is rejected",
  trusted_form_cert_url: "Filed as the lead's consent certificate",
  trustedform_url: "Filed as the lead's consent certificate",
  jornaya_leadid: "Filed as the lead's consent certificate",
  consent_timestamp: "Stored on the consent certificate, when one arrives",
  ip: "Read as the consent IP when consent_ip is absent; required either way",
  source_url: "Stored on the consent certificate, when one arrives",
  landing_page: "Stored on the consent certificate, when one arrives",
};
