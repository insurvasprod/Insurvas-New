"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { notify } from "@/lib/notify";

import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { StatusChip } from "@/components/admin/status-chip";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { TableCard } from "@/components/ui/table-card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_LABELS, type ProductCategory, type ProductRow } from "@/lib/products/constants";
import { cn } from "@/lib/utils";
import { ProductDialog } from "./product-dialog";

const PAGE = 25;
const th = "px-3 py-2 text-left text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const td = "border-t border-[var(--border)] px-3 py-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]";

export type ProductUsage = { templates: number; partners: number };

/**
 * The products board (p-adm-products): the insurance product catalogue every template, partner
 * approval and carrier contract points at. Rows come from the page and refresh through the router,
 * so a product added from the header appears in the figures and the table together.
 */
export function ProductsTable({ products, usage, partnerCount }: { products: ProductRow[]; usage: Record<string, ProductUsage>; partnerCount: number }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"" | ProductCategory>("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const active = products.filter((p) => p.is_active);
  const archivedCount = products.length - active.length;
  const categories = [...new Set(active.map((p) => p.category))];
  const usedByTemplates = active.filter((p) => (usage[p.code]?.templates ?? 0) > 0).length;
  const approved = active.filter((p) => (usage[p.code]?.partners ?? 0) > 0).length;

  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () => products.filter((p) => (includeArchived || p.is_active) && (!category || p.category === category) && (!needle || p.name.toLowerCase().includes(needle) || p.code.toLowerCase().includes(needle))),
    [products, includeArchived, category, needle],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PAGE, current * PAGE);
  const anyFilter = Boolean(needle || category);

  async function setArchived(product: ProductRow, archived: boolean) {
    setPendingId(product.id);
    const response = await fetch(`/api/admin/products/${product.id}`, {
      method: archived ? "DELETE" : "PATCH",
      ...(archived ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: true }) }),
    });
    setPendingId(null);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      notify.block(body?.error ?? "Could not update the product");
      return;
    }
    notify.done(`${product.name} ${archived ? "archived" : "restored"}`);
    router.refresh();
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Products"
        description="A product's code is permanent once created."
        actions={<Button type="button" onClick={() => setCreating(true)}>New product</Button>}
      />

      <BoardStatGrid>
        <BoardStatTile label="Products" value={active.length.toLocaleString()} footnote={archivedCount > 0 ? `${archivedCount} archived` : "none archived"} />
        <BoardStatTile label="Categories" value={categories.length.toLocaleString()} footnote={categories.map((c) => PRODUCT_CATEGORY_LABELS[c]).join(", ") || "none in use"} />
        <BoardStatTile label="Used by templates" value={usedByTemplates.toLocaleString()} footnote={`of ${active.length.toLocaleString()} active`} />
        <BoardStatTile label="Approved for partners" value={approved.toLocaleString()} footnote={`across ${partnerCount.toLocaleString()} ${partnerCount === 1 ? "partner" : "partners"}`} />
      </BoardStatGrid>

      <TableCard
        className="min-w-0"
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
            <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search product or code" />
            <select aria-label="Category" value={category} onChange={(event) => { setCategory(event.target.value as "" | ProductCategory); setPage(1); }} className={toolbarControl}>
              <option value="">Every category</option>
              {PRODUCT_CATEGORIES.map((value) => <option key={value} value={value}>{PRODUCT_CATEGORY_LABELS[value]}</option>)}
            </select>
            <select aria-label="Archived products" value={includeArchived ? "include" : "hide"} onChange={(event) => { setIncludeArchived(event.target.value === "include"); setPage(1); }} className={toolbarControl}>
              <option value="hide">Hide archived</option>
              <option value="include">Including archived{archivedCount > 0 ? ` (${archivedCount})` : ""}</option>
            </select>
            {anyFilter && <Button type="button" variant="ghost" onClick={() => { setQuery(""); setCategory(""); setPage(1); }}>Clear</Button>}
          </DataToolbar>
        }
      >
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr className="bg-[var(--surface-alt)]">
                <th scope="col" className={th}>Product</th>
                <th scope="col" className={cn(th, "w-[170px]")}>Code</th>
                <th scope="col" className={cn(th, "w-[120px]")}>Category</th>
                <th scope="col" className={th}>Description</th>
                <th scope="col" className={cn(th, "w-[70px] text-right")}>Sort</th>
                <th scope="col" className={cn(th, "w-[110px]")}>Status</th>
                <th scope="col" className={cn(th, "w-[56px]")}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={7} className="p-0">
                  {anyFilter ? <NoMatches noun="products" onClear={() => { setQuery(""); setCategory(""); }} /> : <EmptyState title="No products yet" hint="Add what agents actually sell with New product." />}
                </td></tr>
              ) : shown.map((product) => {
                const used = usage[product.code] ?? { templates: 0, partners: 0 };
                return (
                  <tr key={product.id} className={cn("hover:bg-[color-mix(in_srgb,var(--primary),transparent_95%)]", !product.is_active && "opacity-60")}>
                    <td className={td}>
                      <span className="font-semibold text-[var(--ink)]">{product.name}</span>
                      <span className="block text-[12px] text-[var(--muted)]">{used.templates || used.partners ? [used.templates ? `${used.templates} ${used.templates === 1 ? "template" : "templates"}` : null, used.partners ? `${used.partners} ${used.partners === 1 ? "partner" : "partners"}` : null].filter(Boolean).join(" · ") : "Not referenced yet"}</span>
                    </td>
                    <td className={td}><code className="font-mono text-[14px]">{product.code}</code></td>
                    <td className={td}>{PRODUCT_CATEGORY_LABELS[product.category]}</td>
                    <td className={cn(td, "max-w-[320px]")}><span className="line-clamp-2">{product.description ?? "—"}</span></td>
                    <td className={cn(td, "text-right tabular-nums")}>{product.sort_order}</td>
                    <td className={td}>{product.is_active ? <StatusChip tone="good" dot>Active</StatusChip> : <StatusChip tone="neutral">Archived</StatusChip>}</td>
                    <td className={cn(td, "text-right")}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${product.name}`} disabled={pendingId === product.id}>
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(product)}>Edit</DropdownMenuItem>
                          {product.is_active
                            ? <DropdownMenuItem variant="destructive" onSelect={() => void setArchived(product, true)}>Archive</DropdownMenuItem>
                            : <DropdownMenuItem onSelect={() => void setArchived(product, false)}>Restore</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        {rows.length > 0 && <BoardTableFooter page={current} pageSize={PAGE} total={rows.length} itemLabel={rows.length === 1 ? "product" : "products"} order="by sort order" onPageChange={setPage} />}
      </TableCard>

      <ProductDialog mode="create" open={creating} onClose={() => setCreating(false)} onSaved={() => router.refresh()} />
      <ProductDialog key={`edit-${editing?.id ?? "none"}`} mode="edit" product={editing} open={editing !== null} onClose={() => setEditing(null)} onSaved={() => router.refresh()} />
    </div>
  );
}
