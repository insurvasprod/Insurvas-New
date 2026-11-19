"use client";

import { useState, type FormEvent } from "react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { inputControl } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";
import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_LABELS, PRODUCT_CODE_RULE, type ProductRow } from "@/lib/products/constants";

/**
 * New / Edit product (admin round 1, catalog.html screen 5): the same five fields and the same routes as the dialog
 * it replaces, as a right sheet over the list. The code is permanent once created; archive a product rather than
 * renaming or deleting it.
 */
export function ProductDialog({
  mode,
  product,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  product?: ProductRow | null;
  onClose: () => void;
  onSaved: (product: ProductRow | null) => void;
}) {
  const isEdit = mode === "edit";
  const [code, setCode] = useState(product?.code ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState<ProductRow["category"]>(product?.category ?? "life");
  const [description, setDescription] = useState(product?.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(product?.sort_order ?? 0));
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    const response = await fetch(isEdit ? `/api/admin/products/${product!.id}` : "/api/admin/products", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name, category, description, sort_order: sortOrder }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setLoading(false);
    if (!response?.ok) {
      notify.block(body?.error ?? "Could not save the product");
      return;
    }
    notify.done(isEdit ? `${name} updated` : `${name} added`);
    onSaved((body?.product as ProductRow | undefined) ?? null);
  }

  return (
    <Sheet
      title={isEdit ? `Edit ${product?.name ?? "product"}` : "New product"}
      subtitle={isEdit ? "The code is a stable reference for templates, forms and reports." : "Adding a product takes effect immediately; no deploy is needed."}
      onClose={onClose}
      footer={<>
        <span className="flex-1" />
        <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
        <Button type="submit" form="product-form" disabled={loading}>{loading ? "Saving…" : isEdit ? "Save changes" : "Add product"}</Button>
      </>}
    >
      <form id="product-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="product-code">Product code</Label>
          <Input id="product-code" required value={code} onChange={(event) => setCode(event.target.value)} disabled={isEdit} placeholder="e.g. final_expense" />
          <p className="m-0 text-xs text-muted-foreground">{PRODUCT_CODE_RULE}. Permanent once created.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="product-name">Name</Label>
          <Input id="product-name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Final Expense" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="product-category">Category</Label>
          <select id="product-category" className={inputControl} value={category} onChange={(event) => setCategory(event.target.value as ProductRow["category"])}>
            {PRODUCT_CATEGORIES.map((item) => <option key={item} value={item}>{PRODUCT_CATEGORY_LABELS[item]}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="product-description">Description</Label>
          <Input id="product-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="product-sort-order">Sort order</Label>
          <Input id="product-sort-order" type="number" min={0} max={9999} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
        </div>
      </form>
    </Sheet>
  );
}
