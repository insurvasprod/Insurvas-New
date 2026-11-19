"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { PRODUCT_PARTS, ProdSheet, type ProductPart, type ProductUsage } from "@/components/admin/catalog/prod-sheet";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { notify } from "@/lib/notify";
import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_LABELS, type ProductCategory, type ProductRow } from "@/lib/products/constants";
import { cn } from "@/lib/utils";
import { ProductDialog } from "./product-dialog";

export type { ProductUsage };

const EMPTY: ProductUsage = { templates: [], partners: [], carriers: [] };
const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T => (value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback);

/**
 * The products list (admin round 1, catalog.html screen 5): one TableCard, one line a row, the status its one chip.
 * A row opens the product as a right sheet; its Templates, Partners and Carriers counts open the sheet on those rows.
 * The search, the category, "include archived", the page, the open product (`?product=` and `&part=`) and the form
 * sheet (`?new=1`, `?product=<id>&edit=1`) live in the URL without a round trip, so a link lands on the same view.
 */
export function ProductsTable({ products, usage, carriersRead }: { products: ProductRow[]; usage: Record<string, ProductUsage>; carriersRead: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const query = params.get("q") ?? "";
  const category = pick(params.get("category"), ["", ...PRODUCT_CATEGORIES] as const, "");
  const includeArchived = params.get("archived") === "include";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const openId = params.get("product");
  const part = pick(params.get("part"), PRODUCT_PARTS, "details");
  const creating = params.get("new") === "1";
  const editing = params.get("edit") === "1";

  const set = (patch: Record<string, string | null>) => setParamsInPlace(patch);
  const filter = (patch: Record<string, string | null>) => set({ ...patch, page: null });

  const archivedCount = products.filter((p) => !p.is_active).length;
  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () => products.filter((p) => (includeArchived || p.is_active) && (!category || p.category === category) && (!needle || p.name.toLowerCase().includes(needle) || p.code.toLowerCase().includes(needle))),
    [products, includeArchived, category, needle],
  );
  const pageSize = useFittingPageSize(480, 45);
  const { current, rows: shown } = paginate(rows, page, pageSize);
  const anyFilter = Boolean(needle || category);
  const clear = () => filter({ q: null, category: null });
  const open = openId ? products.find((p) => p.id === openId) ?? null : null;

  async function setArchived(product: ProductRow, archived: boolean) {
    setPendingId(product.id);
    const response = await fetch(`/api/admin/products/${product.id}`, {
      method: archived ? "DELETE" : "PATCH",
      ...(archived ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: true }) }),
    }).catch(() => null);
    setPendingId(null);
    if (!response?.ok) {
      const body = await response?.json().catch(() => null);
      notify.block(body?.error ?? "Could not update the product");
      return;
    }
    notify.done(`${product.name} ${archived ? "archived" : "restored"}`);
    // An archived product leaves the list unless archived ones are shown: keep it in view.
    if (archived && !includeArchived) set({ archived: "include" });
    startRefresh(() => router.refresh());
  }

  const count = (product: ProductRow, key: Exclude<ProductPart, "details">, value: number | null, noun: string) => (
    <button
      type="button"
      className="tabular-nums text-foreground hover:underline disabled:text-muted-foreground"
      onClick={(event) => { event.stopPropagation(); set({ product: product.id, part: key, edit: null, new: null }); }}
      aria-label={value === null ? `${noun} for ${product.name} could not be read` : `${value} ${noun} for ${product.name}: open`}
      disabled={value === null}
    >
      {value === null ? "—" : value === 0 ? <span className="text-muted-foreground">0</span> : <>{value.toLocaleString("en-US")} ›</>}
    </button>
  );

  return (
    <>
      <TableCard
        className="min-w-0"
        footer={rows.length ? <Pager page={current} pageSize={pageSize} total={rows.length} noun={rows.length === 1 ? "product" : "products"} suffix="by sort order" onPage={(next) => set({ page: next > 1 ? String(next) : null })} /> : undefined}
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
            <ToolbarSearch value={query} onChange={(value) => filter({ q: value || null })} placeholder="Search product or code" />
            <select aria-label="Category" value={category} onChange={(event) => filter({ category: event.target.value || null })} className={toolbarControl}>
              <option value="">Every category</option>
              {PRODUCT_CATEGORIES.map((value) => <option key={value} value={value}>{PRODUCT_CATEGORY_LABELS[value as ProductCategory]}</option>)}
            </select>
            <select aria-label="Archived products" value={includeArchived ? "include" : "hide"} onChange={(event) => filter({ archived: event.target.value === "include" ? "include" : null })} className={toolbarControl}>
              <option value="hide">Hide archived</option>
              <option value="include">Including archived{archivedCount > 0 ? ` (${archivedCount})` : ""}</option>
            </select>
            {anyFilter && <Button type="button" variant="ghost" onClick={clear}>Clear</Button>}
          </DataToolbar>
        }
      >
        {products.length === 0 ? (
          <EmptyState title="No products yet" hint="Add what agents actually sell with New product." />
        ) : rows.length === 0 ? (
          <NoMatches noun="products" onClear={clear} />
        ) : (
          <Table className="min-w-[1080px]">
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="w-[160px]">Code</TableHead>
                <TableHead className="w-[100px]">Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[90px] text-right">Templates</TableHead>
                <TableHead className="w-[80px] text-right">Partners</TableHead>
                <TableHead className="w-[80px] text-right" title="Carriers that sell it (a platform carrier product) or have a field map for it">Carriers</TableHead>
                <TableHead className="w-[60px] text-right">Sort</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-8"><span className="sr-only">Open</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((product) => {
                const used = usage[product.code] ?? EMPTY;
                const openRow = () => set({ product: product.id, part: null, edit: null, new: null });
                return (
                  <TableRow key={product.id} className={cn("cursor-pointer", !product.is_active && "text-muted-foreground")} onClick={openRow} aria-selected={openId === product.id}>
                    <TableCell className="font-semibold text-foreground">
                      <button type="button" className="max-w-[16rem] truncate text-left hover:underline" onClick={(event) => { event.stopPropagation(); openRow(); }} aria-label={`Open ${product.name}`}>{product.name}</button>
                    </TableCell>
                    <TableCell><code className="font-mono text-sm">{product.code}</code></TableCell>
                    <TableCell>{PRODUCT_CATEGORY_LABELS[product.category]}</TableCell>
                    <TableCell className="max-w-[18rem] truncate" title={product.description ?? undefined}>{product.description ?? "—"}</TableCell>
                    <TableCell className="text-right">{count(product, "templates", used.templates.length, "templates")}</TableCell>
                    <TableCell className="text-right">{count(product, "partners", used.partners.length, "partners")}</TableCell>
                    <TableCell className="text-right">{count(product, "carriers", carriersRead ? used.carriers.length : null, "carriers")}</TableCell>
                    <TableCell className="text-right tabular-nums">{product.sort_order}</TableCell>
                    <TableCell>{product.is_active ? <StatusChip tone="good" dot>Active</StatusChip> : <StatusChip tone="neutral">Archived</StatusChip>}</TableCell>
                    <TableCell className="text-right text-muted-foreground" aria-hidden="true">›</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>

      {open && !editing && !creating && (
        <ProdSheet
          key={open.id}
          product={open}
          usage={usage[open.code] ?? EMPTY}
          carriersRead={carriersRead}
          part={part}
          onPart={(next) => set({ part: next === "details" ? null : next })}
          onClose={() => set({ product: null, part: null })}
          onEdit={() => set({ edit: "1" })}
          onArchive={(archived) => void setArchived(open, archived)}
          pending={pendingId === open.id}
        />
      )}

      {creating && (
        <ProductDialog
          mode="create"
          onClose={() => set({ new: null })}
          onSaved={() => { set({ new: null }); startRefresh(() => router.refresh()); }}
        />
      )}
      {open && editing && (
        <ProductDialog
          key={`edit-${open.id}`}
          mode="edit"
          product={open}
          onClose={() => set({ edit: null })}
          onSaved={() => { set({ edit: null }); startRefresh(() => router.refresh()); }}
        />
      )}
    </>
  );
}
