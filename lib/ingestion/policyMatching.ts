/**
 * LA-4.8 (Notion sprint) · matching a carrier policy to our client: the scores, the shortlist, and
 * the one payload an AI reviewer may ever see.
 *
 *   · each field contributes a weighted score and NO SINGLE FIELD IS DECISIVE: a name alone is not
 *     a match ("James Smith" is not evidence). `isStrong` needs three agreeing fields and a total
 *     no single field can reach.
 *   · the scores rank a shortlist; they never link anything by themselves. Step 3 is decided by a
 *     reviewer — a person today, the AI once a provider is configured.
 *   · the review payload is the documented privacy exception: name, date of birth and phone of the
 *     carrier row and of the SHORTLISTED candidates only, plus premium and face. Never an SSN, bank
 *     details or a full contact record (pinned by policyMatching.test.mjs).
 *
 * Pure; relative imports only.
 */

export const MATCH_FIELDS = ["surname", "givenName", "dob", "phone", "premium", "face"] as const;
export type MatchField = (typeof MATCH_FIELDS)[number];
export const MATCH_FIELD_LABELS: Record<MatchField, string> = { surname: "Surname", givenName: "Given name", dob: "Date of birth", phone: "Phone", premium: "Premium", face: "Face amount" };

/** Weights out of 100. The largest single weight is far below STRONG_SCORE. */
export const MATCH_WEIGHTS: Record<MatchField, number> = { surname: 25, givenName: 15, dob: 25, phone: 20, premium: 10, face: 5 };
export const STRONG_SCORE = 60;
export const STRONG_FIELDS = 3;
/** Candidates are deal-flow entries and applications dated up to this many days before the file. */
export const SHORTLIST_LOOKBACK_DAYS = 14;
export const SHORTLIST_SIZE = 5;

export type Person = { firstName: string | null; lastName: string | null; dob: string | null; phone: string | null; premiumCents: number | null; faceCents: number | null };
export type CarrierSide = Person & { policyNumber: string; carrierName: string; effectiveDate: string | null };
export type Candidate = Person & { type: "deal_flow" | "application"; id: string; contactId: string | null; date: string };
export type FieldOutcome = "match" | "partial" | "mismatch" | "missing";
export type Scored = { candidate: Candidate; score: number; fields: Record<MatchField, FieldOutcome> };

const fold = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/\s+/g, " ").trim();
const tokens = (value: string | null) => (value ? fold(value).split(/[\s'-]+/).filter(Boolean) : []);

/**
 * A carrier's name field as a first and last name. Carriers write "LAST/ FIRST", "Last,First" or
 * "First Last"; a delimiter says which part is the surname, otherwise the last word is.
 */
export function splitName(full: string | null): { firstName: string | null; lastName: string | null } {
  if (!full || !full.trim()) return { firstName: null, lastName: null };
  const delimited = full.match(/^([^,/]+)[,/]\s*(.+)$/);
  if (delimited) return { lastName: delimited[1].trim(), firstName: delimited[2].trim() };
  const words = full.trim().split(/\s+/);
  return words.length === 1 ? { firstName: null, lastName: words[0] } : { firstName: words[0], lastName: words.slice(1).join(" ") };
}

/** Digits only, the last ten (drops a leading country code). */
export const phoneKey = (phone: string | null) => {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
};

function surname(a: string | null, b: string | null): FieldOutcome {
  const x = tokens(a), y = tokens(b);
  if (!x.length || !y.length) return "missing";
  if (x.join(" ") === y.join(" ")) return "match";
  // Compound surnames: "Munoz Bonilla" vs "Bonilla" share a whole word.
  return x.some((word) => word.length > 1 && y.includes(word)) ? "partial" : "mismatch";
}

function givenName(a: string | null, b: string | null): FieldOutcome {
  const x = tokens(a), y = tokens(b);
  if (!x.length || !y.length) return "missing";
  if (x[0] === y[0]) return "match";
  return x[0][0] === y[0][0] && (x[0].length === 1 || y[0].length === 1) ? "partial" : "mismatch";
}

const same = (a: string | null, b: string | null): FieldOutcome => (!a || !b ? "missing" : a === b ? "match" : "mismatch");

function money(a: number | null, b: number | null, tolerance: number): FieldOutcome {
  if (a === null || b === null) return "missing";
  return Math.abs(a - b) <= Math.max(tolerance, Math.round(Math.max(a, b) / 100)) ? "match" : "mismatch";
}

/** One candidate against the carrier row: a weighted score and what each field said. */
export function scoreCandidate(row: CarrierSide, candidate: Candidate): Scored {
  const fields: Record<MatchField, FieldOutcome> = {
    surname: surname(row.lastName, candidate.lastName),
    givenName: givenName(row.firstName, candidate.firstName),
    dob: same(row.dob, candidate.dob),
    phone: same(phoneKey(row.phone), phoneKey(candidate.phone)),
    premium: money(row.premiumCents, candidate.premiumCents, 100),
    face: money(row.faceCents, candidate.faceCents, 0),
  };
  let score = 0;
  for (const field of MATCH_FIELDS) score += fields[field] === "match" ? MATCH_WEIGHTS[field] : fields[field] === "partial" ? Math.round(MATCH_WEIGHTS[field] / 2) : 0;
  return { candidate, score, fields };
}

/** Enough agreement to call it likely — never enough for any one field to do it alone. */
export function isStrong(scored: Pick<Scored, "score" | "fields">): boolean {
  const agreeing = MATCH_FIELDS.filter((field) => scored.fields[field] === "match").length;
  return scored.score >= STRONG_SCORE && agreeing >= STRONG_FIELDS;
}

/** The best few, highest score first; a candidate with no agreeing field at all is dropped. */
export function shortlist(row: CarrierSide, candidates: Candidate[]): Scored[] {
  return candidates
    .map((candidate) => scoreCandidate(row, candidate))
    .filter((scored) => MATCH_FIELDS.some((field) => scored.fields[field] === "match" || scored.fields[field] === "partial"))
    .sort((a, b) => b.score - a.score || a.candidate.date.localeCompare(b.candidate.date) || a.candidate.id.localeCompare(b.candidate.id))
    .slice(0, SHORTLIST_SIZE);
}

/**
 * What the matching agent will be sent (LA-4.19), and nothing more: the compared fields of the
 * carrier row and of the shortlisted candidates, with their scores. Built field by field — never by
 * spreading a record — so nothing extra can ride along.
 */
export function reviewPayload(row: CarrierSide, scored: Scored[]) {
  const person = (p: Person) => ({ first_name: p.firstName, last_name: p.lastName, dob: p.dob, phone: p.phone, premium_cents: p.premiumCents, face_cents: p.faceCents });
  return {
    carrier_row: { carrier: row.carrierName, policy_number: row.policyNumber, effective_date: row.effectiveDate, ...person(row) },
    candidates: scored.map((s, index) => ({ ref: `c${index + 1}`, type: s.candidate.type, date: s.candidate.date, ...person(s.candidate), score: s.score, fields: s.fields })),
  };
}

export type LadderCounts = { alreadyLinked: number; exactLinked: number; toReview: number };

/** The share of policies each ladder step resolved — a high review share means numbers aren't captured at submission. */
export function ladderShare(rows: LadderCounts[]) {
  const total = rows.reduce((sum, row) => ({ alreadyLinked: sum.alreadyLinked + row.alreadyLinked, exactLinked: sum.exactLinked + row.exactLinked, toReview: sum.toReview + row.toReview }), { alreadyLinked: 0, exactLinked: 0, toReview: 0 });
  const all = total.alreadyLinked + total.exactLinked + total.toReview;
  const pct = (n: number) => (all ? Math.round((n / all) * 1000) / 10 : null);
  return { ...total, all, alreadyLinkedPct: pct(total.alreadyLinked), exactLinkedPct: pct(total.exactLinked), toReviewPct: pct(total.toReview) };
}

/**
 * Accuracy of a method against human judgement: of its links a person has since looked at, the share
 * confirmed rather than corrected. Null until there is anything to measure.
 */
export function accuracy(links: Array<{ confirmed: boolean; correctedByHuman: boolean }>): { reviewed: number; correct: number; pct: number | null } {
  const reviewed = links.filter((link) => link.confirmed || link.correctedByHuman);
  const correct = reviewed.filter((link) => link.confirmed && !link.correctedByHuman).length;
  return { reviewed: reviewed.length, correct, pct: reviewed.length ? Math.round((correct / reviewed.length) * 1000) / 10 : null };
}
