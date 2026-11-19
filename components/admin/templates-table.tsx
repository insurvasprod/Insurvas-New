"use client";

import { StatusChip } from "@/components/ui/status-chip";
import { useEffect, useMemo, useRef, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";

import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { st, type PillTone, pillTone } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { TableCard } from "@/components/ui/table-card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProductRow } from "@/lib/products/constants";
import type { TemplateRow } from "@/lib/templates/constants";
import {
  DEFAULT_VISIBLE_STATES,
  EMPTY_TEMPLATE_USAGE,
  TEMPLATE_CATALOG_ORDER,
  TEMPLATE_STATES,
  TEMPLATE_STATE_LABELS,
  activeFilterCount,
  filterTemplates,
  sortTemplatesForCatalog,
  templateSizeDetail,
  templateSizeLabel,
  templateTypeLabel,
  type TemplateState,
  type TemplateUsageSummary,
} from "@/lib/templates/catalog";
import { recordDate, recordDateTime } from "@/lib/tenants/recordFormat";
import { cn } from "@/lib/utils";
import { TemplateEditorDialog } from "./template-editor-dialog";

export type CatalogTemplate = TemplateRow & { state: TemplateState };


const STATE_TONE: Record<TemplateState, PillTone> = {
  published: "success",
  draft: "warning",
  archived: "neutral",
};

/** "12 Sep 2026" in UTC; hover gives the full UTC time and, after mount, the reader's own time. */
function UpdatedDate({ iso }: { iso: string }) {
  const ref = useRef<HTMLTimeElement>(null);
  const utc = recordDateTime(iso);
  useEffect(() => {
    const date = new Date(iso);
    if (ref.current && !Number.isNaN(date.getTime())) {
      ref.current.title = `${utc} · ${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} your time`;
    }
  }, [iso, utc]);
  return (
    <time ref={ref} dateTime={iso} title={utc} className="whitespace-nowrap">
      {recordDate(iso)}
    </time>
  );
}

/**
 * The Templates catalog (admin round 1, docs/design/admin-r1/catalog.html screen 6): the table with its search /
 * product / state toolbar, inside the Catalog frame (the figures and the status line are the page's). A row click —
 * or the name, for the keyboard — opens the editor as a wide right sheet, where editing, duplicating, publishing,
 * archiving and restoring live; the open row carries the brand tint. The search, the product, the states, the page,
 * the open template (`?template=`) and the new-template sheet (`?new=1`) live in the URL without a round trip, so a
 * product's "Templates" count in Products lands here filtered (`?product=<code>`).
 */
export function TemplatesTable({
  templates,
  products,
  usage,
  draftsSupported,
}: {
  templates: CatalogTemplate[];
  products: ProductRow[];
  /** Null when tenant copies or in-progress applications could not be read. */
  usage: TemplateUsageSummary | null;
  /** False until migration 20260925504000 (templates.published_at) is applied. */
  draftsSupported: boolean;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  const productCode = params.get("product") || "all";
  // `?status=draft` (the Catalog workspace's links) is one state; `?states=a,b` is the list's own.
  const statesParam = params.get("states") ?? params.get("status");
  const states = useMemo<TemplateState[]>(
    () => (statesParam === null ? [...DEFAULT_VISIBLE_STATES] : statesParam.split(",").filter((item): item is TemplateState => (TEMPLATE_STATES as readonly string[]).includes(item))),
    [statesParam],
  );
  const page = Math.max(1, Number(params.get("page")) || 1);
  const openId = params.get("template");
  const editor: { mode: "create" | "edit"; id?: string } | null = params.get("new") === "1" ? { mode: "create" } : openId ? { mode: "edit", id: openId } : null;
  const set = (patch: Record<string, string | null>) => setParamsInPlace(patch);
  const setPage = (next: number) => set({ page: next > 1 ? String(next) : null });
  const setEditor = (next: { mode: "create" | "edit"; id?: string } | null) => set(next === null ? { template: null, new: null } : next.mode === "create" ? { new: "1", template: null } : { template: next.id ?? null, new: null });
  const setStates = (next: TemplateState[]) => set({ status: null, states:sameStates(next, DEFAULT_VISIBLE_STATES) ? null : next.join(","), page: null });

  const productOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const template of templates) seen.set(template.product_code, template.product_name);
    // A product with no template yet, arrived at from Products: still named in the picker.
    if (productCode !== "all" && !seen.has(productCode)) seen.set(productCode, products.find((product) => product.code === productCode)?.name ?? productCode);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], "en"));
  }, [templates, products, productCode]);

  const sorted = useMemo(() => sortTemplatesForCatalog(templates), [templates]);
  const filtered = useMemo(
    () => filterTemplates(sorted, (row) => row.state, { query, productCode, states }),
    [sorted, query, productCode, states],
  );

  const filterCount = activeFilterCount({ states });
  const pageSize = useFittingPageSize(420, 45);
  const { current, rows: visible } = paginate(filtered, page, pageSize);
  const editing = editor?.mode === "edit" ? templates.find((template) => template.id === editor.id) ?? null : null;

  function toggleState(state: TemplateState, on: boolean) {
    setStates(on ? [...states, state] : states.filter((item) => item !== state));
  }

  function clearFilters() {
    set({ q: null, product: null, status: null, states: TEMPLATE_STATES.join(","), page: null });
  }

  const openEdit = (template: CatalogTemplate) => setEditor({ mode: "edit", id: template.id });

  return (
    <>
      <TableCard
        footer={templates.length ? <Pager page={current} pageSize={pageSize} total={filtered.length} noun={filtered.length === 1 ? "template" : "templates"} suffix={TEMPLATE_CATALOG_ORDER} onPage={setPage} /> : undefined}
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
            <ToolbarSearch
              value={query}
              onChange={(value) => set({ q: value || null, page: null })}
              placeholder="Search templates"
            />
            <select
              aria-label="Product"
              className={toolbarControl}
              value={productCode}
              onChange={(event) => set({ product: event.target.value === "all" ? null : event.target.value, page: null })}
            >
              <option value="all">All products</option>
              {productOptions.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline">
                  <SlidersHorizontal aria-hidden="true" />
                  Filters
                  {filterCount > 0 && (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs tabular-nums text-foreground">
                      {filterCount}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuLabel>State</DropdownMenuLabel>
                {TEMPLATE_STATES.map((state) => (
                  <DropdownMenuCheckboxItem
                    key={state}
                    checked={states.includes(state)}
                    onCheckedChange={(checked) => toggleState(state, checked === true)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {TEMPLATE_STATE_LABELS[state]}
                    {state === "draft" && !draftsSupported ? " (needs database update)" : ""}
                  </DropdownMenuCheckboxItem>
                ))}
                {filterCount > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => setStates([...TEMPLATE_STATES])}
                    >
                      Show every state
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </DataToolbar>
        }
      >
        <div className="min-w-0 overflow-x-auto">
          <table className={cn(st.table, "min-w-[980px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Template</th>
                <th scope="col" className={cn(st.th, "w-[160px]")}>Product</th>
                <th scope="col" className={cn(st.th, "w-[170px]")}>Type</th>
                <th scope="col" className={cn(st.th, "w-[100px]")}>Version</th>
                <th scope="col" className={cn(st.th, "w-[170px]")}>Size</th>
                <th scope="col" className={cn(st.th, "w-[130px]")}>State</th>
                <th scope="col" className={cn(st.th, "w-[130px]")}>Updated</th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {templates.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState
                      title="No templates yet"
                      hint="A template is the starting workspace an agency picks for a product: its lead fields, pipeline stages and application form."
                    />
                  </td>
                </tr>
              )}
              {templates.length > 0 && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-0">
                    <NoMatches noun="templates" onClear={clearFilters} />
                  </td>
                </tr>
              )}
              {visible.map((template) => {
                const selected = editor?.mode === "edit" && editor.id === template.id;
                return (
                  <tr
                    key={template.id}
                    onClick={() => openEdit(template)}
                    data-selected={selected || undefined}
                    className={cn(
                      "m-row cursor-pointer",
                      selected ? "bg-[var(--brand-50)]" : "hover:bg-[var(--canvas)]",
                      template.state === "archived" && !selected && "[&>td]:text-[var(--muted)]",
                    )}
                  >
                    <td className={st.td}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(template);
                        }}
                        title={template.description ?? undefined}
                        className="cursor-pointer rounded-[4px] text-left text-inherit hover:text-[var(--accent-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                      >
                        {template.name}
                        <span className="sr-only"> — open</span>
                      </button>
                    </td>
                    <td className={st.td}>
                      <span title={template.product_code}>{template.product_name}</span>
                    </td>
                    <td className={st.td}>{templateTypeLabel(template)}</td>
                    <td className={st.td}>
                      <StatusChip dot={false} tone="neutral">v{template.version}</StatusChip>
                    </td>
                    <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>
                      <span title={templateSizeDetail(template)}>{templateSizeLabel(template)}</span>
                    </td>
                    <td className={st.td}>
                      <StatusChip tone={pillTone(STATE_TONE[template.state])} dot>
                        {TEMPLATE_STATE_LABELS[template.state]}
                      </StatusChip>
                    </td>
                    <td className={st.td}>
                      <UpdatedDate iso={template.updated_at} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </TableCard>

      {editor && (editor.mode === "create" || editing) && (
        <TemplateEditorDialog
          key={editor.mode === "create" ? "create" : `edit-${editing?.id}-${editing?.version}-${editing?.state}`}
          mode={editor.mode}
          template={editing}
          state={editing?.state}
          usage={editing ? (usage ? usage.byTemplate[editing.id] ?? EMPTY_TEMPLATE_USAGE : null) : null}
          products={products}
          draftsSupported={draftsSupported}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); startRefresh(() => router.refresh()); }}
        />
      )}
    </>
  );
}

function sameStates(a: readonly TemplateState[], b: readonly TemplateState[]) {
  return a.length === b.length && a.every((state) => b.includes(state));
}
