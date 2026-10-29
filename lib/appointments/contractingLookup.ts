/**
 * Settings › Contracting's search (owner, 29 Oct: "find everything faster, to check if they have
 * something or not"). One box reads a state, a carrier, or both: "texas", "TX", "aetna",
 * "aetna tx", "Mutual of Omaha in Ohio". The Carriers and States tabs filter by what it finds, and
 * when it names one carrier and one state, the page answers the question outright.
 */
import { US_STATES } from "./constants.ts";

export type LookupCarrier = { id: string; name: string };
export type Lookup = {
  /** The state the query names, if any. */
  state: { code: string; name: string } | null;
  /** The carriers the rest of the query matches; null when it names no carrier text at all. */
  carrierIds: string[] | null;
  /** Something was typed that matches no state and no carrier. */
  nothing: boolean;
};

/** Words a person types around the names ("is aetna in texas"), dropped before matching. */
const FILLER = new Set(["in", "is", "with", "for", "am", "i", "are", "we", "do", "does", "have", "appointed", "and", "at", "of", "the", "?"]);
/** State codes that are also everyday words. */
const WORD_CODES = new Set(["in", "or", "me", "ok", "hi", "oh", "id", "al", "la", "co", "pa", "ma", "de", "mo", "ne", "wa"]);
/** Longest names first, so "West Virginia" wins over "Virginia" and "Arkansas" over "Kansas". */
const BY_LENGTH = [...US_STATES].sort((a, b) => b[1].length - a[1].length);

export function parseLookup(query: string, carriers: readonly LookupCarrier[]): Lookup {
  const raw = query.trim();
  if (!raw) return { state: null, carrierIds: null, nothing: false };
  let rest = ` ${raw.toLowerCase().replace(/[?,.]/g, " ").replace(/\s+/g, " ")} `;
  let state: Lookup["state"] = null;

  // A full state name anywhere in the query.
  for (const [code, name] of BY_LENGTH) {
    const needle = ` ${name.toLowerCase()} `;
    if (rest.includes(needle)) { state = { code, name }; rest = rest.replace(needle, " "); break; }
  }
  // Else a two-letter code ("aetna tx"). A code that is also a common word ("in", "or", "me", "ok")
  // counts only in capitals ("aetna IN") or on its own, so "aetna in ohio" is not read as Indiana.
  if (!state) {
    const tokens = raw.replace(/[?,.]/g, " ").split(/\s+/).filter(Boolean);
    const hit = tokens.find((token) => token.length === 2 && (token === token.toUpperCase() || tokens.length === 1 || !WORD_CODES.has(token.toLowerCase())) && US_STATES.some(([code]) => code === token.toUpperCase()));
    if (hit) {
      const [code, name] = US_STATES.find(([c]) => c === hit.toUpperCase())!;
      state = { code, name };
      rest = rest.replace(` ${hit.toLowerCase()} `, " ");
    }
  }
  // A carrier name the query starts to spell ("mutual", "aetna", "mutual of omaha"). Tried whole
  // first, so a name that contains a filler word ("Mutual of Omaha") still matches; then without them.
  const whole = rest.trim();
  const words = whole.split(" ").filter((word) => word && !FILLER.has(word)).join(" ");
  const match = (text: string) => carriers.filter((carrier) => carrier.name.toLowerCase().includes(text)).map((carrier) => carrier.id);
  let carrierIds: string[] | null = null;
  if (whole) {
    const found = match(whole);
    // Only filler words left ("am"): those are what was typed, so they are matched as they are.
    carrierIds = found.length || !words ? found : match(words);
  }
  if (carrierIds !== null && carrierIds.length === 0 && state && !words) carrierIds = null;
  // Partial state names ("tex", "new") when nothing else matched: still a state search.
  if (!state && carrierIds !== null && carrierIds.length === 0) {
    const partial = US_STATES.filter(([code, name]) => name.toLowerCase().startsWith(words) || code.toLowerCase() === words);
    if (partial.length === 1) return { state: { code: partial[0][0], name: partial[0][1] }, carrierIds: null, nothing: false };
  }
  return { state, carrierIds, nothing: !state && carrierIds !== null && carrierIds.length === 0 };
}

/** States whose name or code starts with what was typed: the States tab's partial match ("new" → five). */
export function statesStartingWith(query: string): string[] {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  return US_STATES.filter(([code, name]) => code.toLowerCase() === text || name.toLowerCase().startsWith(text) || name.toLowerCase().includes(` ${text}`)).map(([code]) => code);
}
