/* Pure display helpers for the Daily deal flow (components/app/deal-flow-workspace.tsx); tested in display.test.mjs. */

/**
 * The Product line on a deal: the product's name, then its type when the type says something more
 * ("Term Life · 20-year level"). Never a raw code: the application submission writes the product's code into
 * `product_type` when the carrier product has no label (lib/applications/mutations.ts), so a code-shaped type is
 * named the same way the product is, and dropped when it only repeats it ("Term Life", not "Term Life · term_life").
 */
const CODE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function dealProductText(productLine: string | null | undefined, productType: string | null | undefined, nameOf: (code: string) => string): string {
  const line = productLine?.trim() ? nameOf(productLine.trim()) : null;
  const rawType = productType?.trim() || null;
  const type = rawType && CODE.test(rawType) ? nameOf(rawType) : rawType;
  if (line && type && line.toLowerCase() === type.toLowerCase()) return line;
  return [line, type].filter(Boolean).join(" · ") || "—";
}

/** A face amount is whole dollars ("$250,000"); cents show only when it has them ("$1,250.50"). */
export function faceAmountText(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
}

/** "term_life" → "Term Life": a code made readable when the sold list has no name for it (Title Case, UI-CONSISTENCY). */
export function readableProductCode(code: string): string {
  return code.split("_").filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}
