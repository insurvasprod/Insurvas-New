"use client";

import { useCallback, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PRODUCT_CATEGORY_LABELS, type ProductRow } from "@/lib/products/constants";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";
import { ProductDialog } from "./product-dialog";

export function ProductsTable({ initialProducts }: { initialProducts: ProductRow[] }) {
  const [products, setProducts] = useState(initialProducts);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/products");
    if (response.ok) setProducts((await response.json()).products);
  }, []);

  async function setArchived(product: ProductRow, archived: boolean) {
    setPendingId(product.id);
    const response = await fetch(`/api/admin/products/${product.id}`, {
      method: archived ? "DELETE" : "PATCH",
      ...(archived ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: true }) }),
    });
    setPendingId(null);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      toast.error(body?.error ?? "Could not update the product");
      return;
    }
    toast.success(`${product.name} ${archived ? "archived" : "restored"}`);
    refresh();
  }

  const active = products.filter((product) => product.is_active);
  const archived = products.filter((product) => !product.is_active);
  const visible = showArchived ? products : active;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{active.length} active{archived.length > 0 && ` · ${archived.length} archived`}</p>
        {archived.length > 0 && <Button variant="outline" size="sm" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Hide archived" : "Show archived"}</Button>}
        <div className="ml-auto"><Button size="sm" onClick={() => setCreating(true)}>New product</Button></div>
      </div>
      <div className={tableShell}>
        <Table>
          <TableHeader><TableRow className={tableHeaderRow}><TableHead className={tableHeadCell}>Product</TableHead><TableHead className={tableHeadCell}>Code</TableHead><TableHead className={tableHeadCell}>Category</TableHead><TableHead className={tableHeadCell}>Description</TableHead><TableHead className={tableHeadCell}>Order</TableHead><TableHead className={`${tableHeadCell} w-10`} /></TableRow></TableHeader>
          <TableBody>
            {visible.length === 0 && <TableRow><TableCell colSpan={6} className="h-20 text-center text-sm text-muted-foreground">No products yet. Templates and reporting both reference this list, so add what agents actually sell.</TableCell></TableRow>}
            {visible.map((product) => <TableRow key={product.id} className={!product.is_active ? "opacity-55" : undefined}>
              <TableCell className="font-medium"><span className="flex items-center gap-2">{product.name}{!product.is_active && <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">Archived</Badge>}</span></TableCell>
              <TableCell><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{product.code}</code></TableCell>
              <TableCell>{PRODUCT_CATEGORY_LABELS[product.category]}</TableCell>
              <TableCell className="max-w-[260px] truncate text-muted-foreground">{product.description ?? "—"}</TableCell>
              <TableCell>{product.sort_order}</TableCell>
              <TableCell><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" disabled={pendingId === product.id}><MoreHorizontal /><span className="sr-only">Actions</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setEditing(product)}>Edit</DropdownMenuItem>{product.is_active ? <DropdownMenuItem variant="destructive" onSelect={() => setArchived(product, true)}>Archive</DropdownMenuItem> : <DropdownMenuItem onSelect={() => setArchived(product, false)}>Restore</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
      </div>
      <ProductDialog mode="create" open={creating} onClose={() => setCreating(false)} onSaved={refresh} />
      <ProductDialog key={`edit-${editing?.id ?? "none"}`} mode="edit" product={editing} open={editing !== null} onClose={() => setEditing(null)} onSaved={refresh} />
    </div>
  );
}
