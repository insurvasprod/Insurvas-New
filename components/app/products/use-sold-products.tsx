"use client";

/**
 * The products this agency sells (Settings › Products, owner 2026-10-27), for every product picker
 * in the agent app. One read of GET /api/app/products/sold, shared by every picker on the page; the
 * server checks the same answer (lib/products/agencyProducts.ts) before it writes anything.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import { ToggleChip } from "@/components/ui/toggle-chip";

export type SoldProduct = { code: string; name: string; category: string };

let shared: Promise<SoldProduct[]> | null = null;

function loadSold(): Promise<SoldProduct[]> {
  shared ??= fetch("/api/app/products/sold", { cache: "no-store" })
    .then(async (response) => ((await response.json().catch(() => null)) as { products?: SoldProduct[] } | null)?.products ?? [])
    .catch(() => [])
    .finally(() => { setTimeout(() => { shared = null; }, 30_000); });
  return shared;
}

/** null while loading. */
export function useSoldProducts(): SoldProduct[] | null {
  const [products, setProducts] = useState<SoldProduct[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadSold().then((list) => { if (live) setProducts(list); });
    return () => { live = false; };
  }, []);
  return products;
}

/** A product's name from the sold list, else the code made readable. */
export function productName(products: SoldProduct[] | null, code: string) {
  return products?.find((product) => product.code === code)?.name ?? code.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

/**
 * A list of product codes picked as chips from what the agency sells. Reads and writes the same
 * comma-separated text the routing rules already store, so nothing about the saved shape changes;
 * a code already in the list that is no longer sold stays shown so it can be removed.
 */
export function ProductChips({ value, onChange, disabled, label }: { value: string; onChange: (next: string) => void; disabled?: boolean; label: string }) {
  const products = useSoldProducts();
  const picked = value.split(",").map((code) => code.trim()).filter(Boolean);
  const codes = [...new Set([...(products ?? []).map((product) => product.code), ...picked])];
  const toggle = (code: string) => onChange((picked.includes(code) ? picked.filter((item) => item !== code) : [...picked, code]).join(", "));
  if (products && codes.length === 0) {
    return <p className="m-0 text-sm text-[var(--muted)]">Your agency does not sell any product yet. <Link href="/app/settings#products" className="font-semibold text-[var(--ink)] underline underline-offset-2">Choose them in Settings › Products</Link></p>;
  }
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {codes.map((code) => (
        <ToggleChip key={code} selected={picked.includes(code)} disabled={disabled} onClick={() => toggle(code)}>{productName(products, code)}</ToggleChip>
      ))}
    </div>
  );
}
