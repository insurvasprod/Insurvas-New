"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";

import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { Pill, st, type PillTone } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
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

const PAGE_SIZE = 25;

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
 * The Templates catalog (board p-adm-templates): header, figures, and the table with its search /
 * product / state toolbar. A row click — or the name, for the keyboard — opens the
 * editor, where editing, duplicating, publishing, archiving and restoring live; the open row carries
 * the brand tint, as on the board.
 */
export function TemplatesTable({
  templates,
  products,
  tiles,
  usage,
  draftsSupported,
}: {
  templates: CatalogTemplate[];
  products: ProductRow[];
  tiles: ReactNode;
  /** Null when tenant copies or in-progress applications could not be read. */
  usage: TemplateUsageSummary | null;
  /** False until migration 20260925504000 (templates.published_at) is applied. */
  draftsSupported: boolean;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; id?: string } | null>(null);
  const [query, setQuery] = useState("");
  const [productCode, setProductCode] = useState<string>("all");
  const [states, setStates] = useState<TemplateState[]>([...DEFAULT_VISIBLE_STATES]);
  const [page, setPage] = useState(1);

  const productOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const template of templates) seen.set(template.product_code, template.product_name);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], "en"));
  }, [templates]);

  const sorted = useMemo(() => sortTemplatesForCatalog(templates), [templates]);
  const filtered = useMemo(
    () => filterTemplates(sorted, (row) => row.state, { query, productCode, states }),
    [sorted, query, productCode, states],
  );

  const filterCount = activeFilterCount({ states });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const editing = editor?.mode === "edit" ? templates.find((template) => template.id === editor.id) ?? null : null;

  function toggleState(state: TemplateState, on: boolean) {
    setStates((currentStates) => (on ? [...currentStates, state] : currentStates.filter((item) => item !== state)));
    setPage(1);
  }

  function clearFilters() {
    setQuery("");
    setProductCode("all");
    setStates([...TEMPLATE_STATES]);
    setPage(1);
  }

  const openEdit = (template: CatalogTemplate) => setEditor({ mode: "edit", id: template.id });

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Templates"
        actions={
          <Button type="button" onClick={() => setEditor({ mode: "create" })}>
            New template
          </Button>
        }
      />

      {tiles}

      <TableCard
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
            <ToolbarSearch
              value={query}
              onChange={(value) => {
                setQuery(value);
                setPage(1);
              }}
              placeholder="Search templates"
            />
            <select
              aria-label="Product"
              className={toolbarControl}
              value={productCode}
              onChange={(event) => {
                setProductCode(event.target.value);
                setPage(1);
              }}
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
                      onSelect={() => {
                        setStates([...TEMPLATE_STATES]);
                        setPage(1);
                      }}
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
                      <Pill tone="neutral">v{template.version}</Pill>
                    </td>
                    <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>
                      <span title={templateSizeDetail(template)}>{templateSizeLabel(template)}</span>
                    </td>
                    <td className={st.td}>
                      <Pill tone={STATE_TONE[template.state]} dot>
                        {TEMPLATE_STATE_LABELS[template.state]}
                      </Pill>
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
        {templates.length > 0 && (
          <BoardTableFooter
            page={current}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            itemLabel={filtered.length === 1 ? "template" : "templates"}
            order={TEMPLATE_CATALOG_ORDER}
            onPageChange={setPage}
          />
        )}
      </TableCard>

      {editor && (editor.mode === "create" || editing) && (
        <TemplateEditorDialog
          key={editor.mode === "create" ? "create" : `edit-${editing?.id}-${editing?.version}-${editing?.state}`}
          mode={editor.mode}
          open
          template={editing}
          state={editing?.state}
          usage={editing ? (usage ? usage.byTemplate[editing.id] ?? EMPTY_TEMPLATE_USAGE : null) : null}
          products={products}
          draftsSupported={draftsSupported}
          onClose={() => setEditor(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
