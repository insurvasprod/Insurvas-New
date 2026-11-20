/**
 * A product code as a person reads it: `term_life` → "Term Life", `aca_health` → "ACA Health".
 *
 * Product codes are free text (a lead's `product_line` feeds them, and the disclosure form accepts
 * codes outside its suggested list), so this spells out any code rather than looking it up in a
 * fixed table that the next new product would fall out of. Title Case, as every label in the app
 * (walk 2026-11-20: the lead's chip read "Term life" while the case read "Term Life"); short joining
 * words ("of", "and") stay lower case after the first word, as in "Return of Premium".
 */
const ACRONYMS = new Set(["aca", "iul", "ul", "adb", "ad&d", "hmo", "ppo"]);
const MINOR = new Set(["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with"]);

export function productLineLabel(code: string | null | undefined): string {
  const words = String(code ?? "").trim().split(/[_\s-]+/).filter(Boolean);
  if (!words.length) return "—";
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      if (index > 0 && MINOR.has(lower)) return lower;
      return lower[0].toUpperCase() + lower.slice(1);
    })
    .join(" ");
}
