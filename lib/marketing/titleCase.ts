/**
 * Title case for the landing page's feature cards (owner, 12 Nov: "make each word start with a
 * capital, except a, the, it — these kinds of words").
 *
 * Built to be safe on the cards' sample data, which is why it only ever *raises* a first letter:
 *   - never lowercases anything, so TCPA, DNC, CSV and "Ruth A." come through as written;
 *   - leaves alone any word that already holds a capital (CSV, SAMPLE-0482, iPhone) and anything
 *     shaped like a file name or address (cobalt-media.csv), which must not change;
 *   - keeps the small words lower case — articles, short conjunctions and prepositions, plus "it"
 *     and "its", which the owner named — except where a phrase starts: the first and last word, and
 *     the word after a full stop, colon, semicolon, or one of the separators the cards use ( · — / ).
 */

const SMALL = new Set([
  "a", "an", "the",
  "and", "but", "or", "nor", "for", "so", "yet",
  "as", "at", "by", "in", "of", "on", "to", "up", "off", "per", "via", "vs", "vs.", "if", "en",
  "it", "its",
]);

/** A word ends a phrase when it closes with sentence punctuation; a bare separator always does. */
const ENDS_PHRASE = /[.:;!?]$/;
const SEPARATOR = /^[·—–/|&×]$/;

export function titleCase(text: string): string {
  const parts = text.split(/(\s+)/);
  const words = parts.map((part, i) => ({ part, i })).filter(({ part }) => part.trim() !== "");
  const last = words.length - 1;
  let startOfPhrase = true;

  words.forEach(({ part, i }, n) => {
    const atEdge = startOfPhrase || n === last;
    startOfPhrase = SEPARATOR.test(part) || ENDS_PHRASE.test(part);

    // Already carries a capital (an acronym, an ID, a name) or looks like a file name: leave it.
    if (/[A-Z]/.test(part) || /\w\.\w/.test(part) || /[@\\]/.test(part)) return;
    const bare = part.toLowerCase().replace(/[^a-z.]/g, "");
    if (!atEdge && SMALL.has(bare)) return;
    // Raise the first letter, wherever it sits ("(optional)" → "(Optional)", "4" stays "4"), and the
    // first letter after each hyphen, so "Sign-in" reads "Sign-In". File names never reach here.
    parts[i] = part.replace(/[a-z]/, (c) => c.toUpperCase()).replace(/-([a-z])/g, (_, c: string) => `-${c.toUpperCase()}`);
  });

  return parts.join("");
}
