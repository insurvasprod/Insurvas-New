"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_LABELS, PRODUCT_CODE_RULE, type ProductRow } from "@/lib/products/constants";

export function ProductDialog({
  mode,
  open,
  product,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  open: boolean;
  product?: ProductRow | null;
  onClose: () => void;
  onSaved: () => void;
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
    });
    const body = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok) {
      toast.error(body?.error ?? "Could not save the product");
      return;
    }
    toast.success(isEdit ? `${name} updated` : `${name} added`);
    onSaved();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit product" : "New product"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "The product code is a stable reference for templates, forms and reports. Archive it instead of renaming or deleting it."
                : "Adding a product takes effect immediately; no deploy is needed."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="product-code">Product code</Label>
              <Input id="product-code" required value={code} onChange={(event) => setCode(event.target.value)} disabled={isEdit} placeholder="e.g. final_expense" />
              <p className="text-xs text-muted-foreground">{PRODUCT_CODE_RULE}. Permanent once created.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-name">Name</Label>
              <Input id="product-name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Final Expense" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-category">Category</Label>
              <Select value={category} onValueChange={(value) => setCategory(value as ProductRow["category"])}>
                <SelectTrigger id="product-category" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{PRODUCT_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{PRODUCT_CATEGORY_LABELS[item]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-description">Description</Label>
              <Input id="product-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-sort-order">Sort order</Label>
              <Input id="product-sort-order" type="number" min={0} max={9999} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
            </div>
          </div>
          <DialogFooter><Button type="submit" disabled={loading}>{loading ? "Saving…" : isEdit ? "Save changes" : "Add product"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
