"use client";

import { ToggleChip } from "@/components/ui/toggle-chip";

/**
 * The Forms list's one filter (board A1): All products, then one chip per product the agency sells,
 * each with how many forms it has.
 */
export function ProductChips({ products, value, counts, onChange }: {
  products: ReadonlyArray<{ code: string; name: string }>;
  /** "" for all products. */
  value: string;
  counts: Readonly<Record<string, number>>;
  onChange: (code: string) => void;
}) {
  if (products.length < 2) return null;
  return (
    <div role="radiogroup" aria-label="Products" className="flex flex-wrap gap-2">
      <ToggleChip role="radio" selected={value === ""} onClick={() => onChange("")}>All products</ToggleChip>
      {products.map((product) => (
        <ToggleChip key={product.code} role="radio" selected={value === product.code} onClick={() => onChange(product.code)} count={counts[product.code] || undefined}>
          <span>{product.name}</span>
        </ToggleChip>
      ))}
    </div>
  );
}
