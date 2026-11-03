"use client";

import { ToggleChip } from "@/components/ui/toggle-chip";

/**
 * Form templates, layout A: one chip per product, one form each (board FtA). Each chip carries its
 * product's live version; the open one carries its unpublished changes instead, in the warning tone.
 */
export function ProductChips({ products, value, changes, liveVersions, onChange }: {
  products: ReadonlyArray<{ code: string; name: string }>;
  value: string;
  /** Unpublished changes on the open product's form. */
  changes: number;
  /** product code → its live form version; a product with no form yet is absent. */
  liveVersions: Readonly<Record<string, number>>;
  onChange: (code: string) => void;
}) {
  if (products.length < 2) return null;
  return (
    <div role="radiogroup" aria-label="Products" className="flex flex-wrap gap-2">
      {products.map((product) => {
        const open = product.code === value;
        const pending = open && changes > 0;
        const live = liveVersions[product.code];
        return (
          <ToggleChip
            key={product.code}
            role="radio"
            selected={open}
            onClick={() => onChange(product.code)}
            count={pending ? changes : live ? `v${live}` : undefined}
            countTone={pending ? "warning" : undefined}
          >
            <span>{product.name}</span>
          </ToggleChip>
        );
      })}
    </div>
  );
}
