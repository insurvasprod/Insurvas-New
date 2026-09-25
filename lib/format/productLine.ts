/**
 * A product code as a person reads it: `term_life` → "Term life", `aca_health` → "ACA health".
 *
 * Product codes are free text (a lead's `product_line` feeds them, and the disclosure form accepts
 * codes outside its suggested list), so this spells out any code rather than looking it up in a
 * fixed table that the next new product would fall out of. Sentence case, as the boards draw it.
 */
const ACRONYMS = new Set(["aca", "iul", "ul", "adb", "ad&d", "hmo", "ppo"]);

export function productLineLabel(code: string | null | undefined): string {
  const words = String(code ?? "").trim().split(/[_\s-]+/).filter(Boolean);
  if (!words.length) return "—";
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return index === 0 ? lower[0].toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}
